import { createApp } from './bootstrap/app.js';
import { config } from './bootstrap/config.js';

const app = createApp();

const port = Number(config.PORT) || 8080;
app.listen(port, () => {
  console.log(`[HHH SQL API] Service listening on port ${port} in ${config.NODE_ENV} mode`);
});

export { app };
