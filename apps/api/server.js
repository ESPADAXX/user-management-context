import { createApp } from './src/app.js';

const port = Number(process.env.PORT) || 3000;
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('JWT_SECRET must be set in production.');
  process.exit(1);
}
const { server, ctx } = createApp({ databasePath: process.env.DATABASE_PATH ?? 'data.sqlite' });
server.listen(port, () => {
  console.log(`API on http://localhost:${port}/api — built from context v${ctx.manifest?.contextVersion ?? '?'}`);
});
