exports.sendFile = sendFile;
const tl_1 = require("../tl");
const Helpers_1 = require("../Helpers");
const Utils_1 = require("../Utils");
const path_1 = __importDefault(require("./path"));
const fs_1 = require("./fs");
const index_1 = require("../index");
const messageParse_1 = require("./messageParse");
const messages_1 = require("./messages");
const big_integer_1 = __importDefault(require("big-integer"));
/**
 * A custom file class that mimics the browser's File class.<br/>
 * You should use this whenever you want to upload a file.
 */
class CustomFile {
    constructor(name, size, path, buffer) {
        this.name = name;
        this.size = size;
        this.path = path;
        this.buffer = buffer;
    }
}
exports.CustomFile = CustomFile;
class CustomBuffer {
    constructor(options) {
        this.options = options;
        if (!options.buffer && !options.filePath) {
            throw new Error("Either one of `buffer` or `filePath` should be specified");
        }
    }
    async slice(begin, end) {
        const { buffer, filePath } = this.options;
        if (buffer) {
            return buffer.slice(begin, end);
        }
        else if (filePath) {
            const buffSize = end - begin;
            const buff = Buffer.alloc(buffSize);
            const fHandle = await fs_1.promises.open(filePath, "r");
            await fHandle.read(buff, 0, buffSize, begin);
            await fHandle.close();
            return Buffer.from(buff);
        }
        return Buffer.alloc(0);
    }
}
const KB_TO_BYTES = 1024;
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT = 15 * 1000;
const DISCONNECT_SLEEP = 1000;
const BUFFER_SIZE_2GB = 2 ** 31;
const BUFFER_SIZE_20MB = 20 * 1024 * 1024;
async function getFileBuffer(file, fileSize, maxBufferSize) {
    const options = {};
    if (fileSize > maxBufferSize && file instanceof CustomFile) {
        options.filePath = file.path;
    }
    else {
        options.buffer = Buffer.from(await fileToBuffer(file));
    }
    return new CustomBuffer(options);
}
/** @hidden */
async function uploadFile(client, fileParams) {
    const { file, onProgress } = fileParams;
    let { workers } = fileParams;
    const { name, size } = file;
    const fileId = (0, Helpers_1.readBigIntFromBuffer)((0, Helpers_1.generateRandomBytes)(8), true, true);
    const isLarge = size > LARGE_FILE_THRESHOLD;
    const partSize = (0, Utils_1.getAppropriatedPartSize)((0, big_integer_1.default)(size)) * KB_TO_BYTES;
    const partCount = Math.floor((size + partSize - 1) / partSize);
    const buffer = await getFileBuffer(file, size, fileParams.maxBufferSize || BUFFER_SIZE_20MB - 1);
    // Make sure a new sender can be created before starting upload
    await client.getSender(client.session.dcId);
    if (!workers || !size) {
        workers = 1;
    }
    if (workers >= partCount) {
        workers = partCount;
    }
    let progress = 0;
    if (onProgress) {
        onProgress(progress);
    }
    for (let i = 0; i < partCount; i += workers) {
        const sendingParts = [];
        let end = i + workers;
        if (end > partCount) {
            end = partCount;
        }
        for (let j = i; j < end; j++) {
            let endPart = (j + 1) * partSize;
            if (endPart > size) {
                endPart = size;
            }
            if (endPart == j * partSize) {
                break;
            }
            const bytes = await buffer.slice(j * partSize, endPart);
            // eslint-disable-next-line no-loop-func
            sendingParts.push((async (jMemo, bytesMemo) => {
                while (true) {
                    let sender;
                    try {
                        // We always upload from the DC we are in
                        sender = await client.getSender(client.session.dcId);
                        await sender.send(isLarge
                            ? new tl_1.Api.upload.SaveBigFilePart({
                                fileId,
                                filePart: jMemo,
                                fileTotalParts: partCount,
                                bytes: bytesMemo,
                            })
                            : new tl_1.Api.upload.SaveFilePart({
                                fileId,
                                filePart: jMemo,
                                bytes: bytesMemo,
                            }));
                    }
                    catch (err) {
                        if (sender && !sender.isConnected()) {
                            await (0, Helpers_1.sleep)(DISCONNECT_SLEEP);
                            continue;
                        }
                        else if (err instanceof index_1.errors.FloodWaitError) {
                            await (0, Helpers_1.sleep)(err.seconds * 1000);
                            continue;
                        }
                        throw err;
                    }
                    if (onProgress) {
                        if (onProgress.isCanceled) {
                            throw new Error("USER_CANCELED");
                        }
                        progress += 1 / partCount;
                        onProgress(progress);
                    }
                    break;
                }
            })(j, bytes));
        }
        await Promise.all(sendingParts);
    }
    return isLarge
        ? new tl_1.Api.InputFileBig({
            id: fileId,
            parts: partCount,
            name,
        })
        : new tl_1.Api.InputFile({
            id: fileId,
            parts: partCount,
            name,
            md5Checksum: "", // This is not a "flag", so not sure if we can make it optional.
        });
}
/** @hidden */
async function _fileToMedia(client, { file, forceDocument, fileSize, progressCallback, attributes, thumb, voiceNote = false, videoNote = false, supportsStreaming = false, mimeType, asImage, workers = 1, }) {
    if (!file) {
        return { fileHandle: undefined, media: undefined, image: undefined };
    }
    const isImage = index_1.utils.isImage(file);
    if (asImage == undefined) {
        asImage = isImage && !forceDocument;
    }
    if (typeof file == "object" &&
        !Buffer.isBuffer(file) &&
        !(file instanceof tl_1.Api.InputFile) &&
        !(file instanceof tl_1.Api.InputFileBig) &&
        !(file instanceof CustomFile) &&
        !("read" in file)) {
        try {
            return {
                fileHandle: undefined,
                media: index_1.utils.getInputMedia(file, {
                    isPhoto: asImage,
                    attributes: attributes,
                    forceDocument: forceDocument,
                    voiceNote: voiceNote,
                    videoNote: videoNote,
                    supportsStreaming: supportsStreaming,
                }),
                image: asImage,
            };
        }
        catch (e) {
            return {
                fileHandle: undefined,
                media: undefined,
                image: isImage,
            };
        }
    }
    let media;
    let fileHandle;
    let createdFile;
    if (file instanceof tl_1.Api.InputFile || file instanceof tl_1.Api.InputFileBig) {
        fileHandle = file;
    }
    else if (typeof file == "string" &&
        (file.startsWith("https://") || file.startsWith("http://"))) {
        if (asImage) {
            media = new tl_1.Api.InputMediaPhotoExternal({ url: file });
        }
        else {
            media = new tl_1.Api.InputMediaDocumentExternal({ url: file });
        }
    }
    else if (!(typeof file == "string") || (await fs_1.promises.lstat(file)).isFile()) {
        if (typeof file == "string") {
            createdFile = new CustomFile(path_1.default.basename(file), (await fs_1.promises.stat(file)).size, file);
        }
        else if ((typeof File !== "undefined" && file instanceof File) ||
            file instanceof CustomFile) {
            createdFile = file;
        }
        else {
            let name;
            if ("name" in file) {
                // @ts-ignore
                name = file.name;
            }
            else {
                name = "unnamed";
            }
            if (Buffer.isBuffer(file)) {
                createdFile = new CustomFile(name, file.length, "", file);
            }
        }
        if (!createdFile) {
            throw new Error(`Could not create file from ${JSON.stringify(file)}`);
        }
        fileHandle = await uploadFile(client, {
            file: createdFile,
            onProgress: progressCallback,
            workers: workers,
        });
    }
    else {
        throw new Error(`"Not a valid path nor a url ${file}`);
    }
    if (media != undefined) {
    }
    else if (fileHandle == undefined) {
        throw new Error(`Failed to convert ${file} to media. Not an existing file or an HTTP URL`);
    }
    else if (asImage) {
        media = new tl_1.Api.InputMediaUploadedPhoto({
            file: fileHandle,
        });
    }
    else {
        // @ts-ignore
        let res = index_1.utils.getAttributes(file, {
            mimeType: mimeType,
            attributes: attributes,
            forceDocument: forceDocument && !isImage,
            voiceNote: voiceNote,
            videoNote: videoNote,
            supportsStreaming: supportsStreaming,
            thumb: thumb,
        });
        attributes = res.attrs;
        mimeType = res.mimeType;
        let uploadedThumb;
        if (!thumb) {
            uploadedThumb = undefined;
        }
        else {
            // todo refactor
            if (typeof thumb == "string") {
                uploadedThumb = new CustomFile(path_1.default.basename(thumb), (await fs_1.promises.stat(thumb)).size, thumb);
            }
            else if (typeof File !== "undefined" && thumb instanceof File) {
                uploadedThumb = thumb;
            }
            else {
                let name;
                if ("name" in thumb) {
                    name = thumb.name;
                }
                else {
                    name = "unnamed";
                }
                if (Buffer.isBuffer(thumb)) {
                    uploadedThumb = new CustomFile(name, thumb.length, "", thumb);
                }
            }
            if (!uploadedThumb) {
                throw new Error(`Could not create file from ${file}`);
            }
            uploadedThumb = await uploadFile(client, {
                file: uploadedThumb,
                workers: 1,
            });
        }
        media = new tl_1.Api.InputMediaUploadedDocument({
            file: fileHandle,
            mimeType: mimeType,
            attributes: attributes,
            thumb: uploadedThumb,
            forceFile: forceDocument && !isImage,
        });
    }
    return {
        fileHandle: fileHandle,
        media: media,
        image: asImage,
    };
}
/** @hidden */
