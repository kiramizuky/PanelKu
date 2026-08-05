import pg from 'pg';
const cfg = { host: '127.0.0.1', port: 5432, user: 'postgres', password: '', connectionTimeoutMillis: 5000 };

const c = new pg.Client({ ...cfg, database: 'postgres' });
await c.connect();
const dbs = await c.query('SELECT datname FROM pg_database WHERE datistemplate=false');
console.log('DBS:', dbs.rows.map(r => r.datname).join(', '));
if (!dbs.rows.some(r => r.datname === 'testdb')) {
  await c.query('CREATE DATABASE testdb');
  console.log('CREATED testdb');
}
await c.end();

const t = new pg.Client({ ...cfg, database: 'testdb' });
await t.connect();
await t.query('CREATE SCHEMA IF NOT EXISTS analytics; CREATE SCHEMA IF NOT EXISTS inventory;');
await t.query('CREATE TABLE IF NOT EXISTS public.users(id serial primary key, name text);');
await t.query('CREATE TABLE IF NOT EXISTS analytics.events(id serial primary key, event text);');
await t.query('CREATE TABLE IF NOT EXISTS inventory.products(id serial primary key, sku text);');
await t.query("DELETE FROM public.users; INSERT INTO public.users(name) VALUES ('alice'),('bob');");
await t.query("DELETE FROM analytics.events; INSERT INTO analytics.events(event) VALUES ('login'),('logout'),('purchase');");
await t.query("DELETE FROM inventory.products; INSERT INTO inventory.products(sku) VALUES ('A-1'),('B-2'),('C-3');");

const schemas = await t.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY 1");
console.log('SCHEMAS:', schemas.rows.map(r => r.schema_name).join(', '));
const tables = await t.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public','analytics','inventory') ORDER BY 1,2");
console.log('TABLES:', tables.rows.map(r => r.table_schema + '.' + r.table_name).join(', '));
const counts = await t.query("SELECT 'public.users' AS t, COUNT(*) FROM public.users UNION ALL SELECT 'analytics.events', COUNT(*) FROM analytics.events UNION ALL SELECT 'inventory.products', COUNT(*) FROM inventory.products");
console.log('ROWS:', counts.rows.map(r => r.t + '=' + r.count).join(', '));
await t.end();
console.log('SETUP-OK');
process.exit(0);
