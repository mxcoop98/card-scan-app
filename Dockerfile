FROM node:22-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Railway injects PORT; server.js reads process.env.PORT
EXPOSE 3000

CMD ["node", "src/server.js"]
