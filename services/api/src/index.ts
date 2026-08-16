import { app } from './app.js';
import { config } from './config.js';

const server = app.listen(config.PORT, '0.0.0.0', () => console.log(`HHH API listening on port ${config.PORT}`));
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
