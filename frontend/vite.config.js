import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend runs on http://localhost:5173
// Backend (FastAPI) runs on http://127.0.0.1:8000
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});