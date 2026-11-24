import { defineConfig } from 'vite';

// GitHub Pages では https://<ユーザー>.github.io/tour-on-map/ で配信するため base を固定
export default defineConfig({
  base: '/tour-on-map/',
});
