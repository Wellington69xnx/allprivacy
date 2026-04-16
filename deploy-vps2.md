# Deploy VPS

Arquivos para renomear na VPS:

- `.env2` -> `.env`
- `ecosystem.config.cjs2` -> `ecosystem.config.cjs`
- `allprivacy.site.nginx.conf2` -> `allprivacy.site.nginx.conf`

## 1. Instalar dependencias

```bash
sudo apt update
sudo apt install -y git curl ffmpeg nginx build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. Dentro da pasta do projeto

```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

## 3. Configurar o nginx

```bash
sudo mv allprivacy.site.nginx.conf /etc/nginx/sites-available/allprivacy.site
sudo ln -s /etc/nginx/sites-available/allprivacy.site /etc/nginx/sites-enabled/allprivacy.site
sudo nginx -t
sudo systemctl restart nginx
```

## 4. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 5. Comandos uteis

```bash
pm2 list
pm2 logs allprivacy
pm2 restart allprivacy --update-env
pm2 stop allprivacy
pm2 delete allprivacy
```

## 6. Observacao

O projeto deve rodar em producao com:

```bash
npm run build
pm2 start ecosystem.config.cjs
```

Nao use `npm run dev` na VPS para deploy.
