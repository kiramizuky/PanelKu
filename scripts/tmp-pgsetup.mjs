import pg from 'pg';
const cfg = { host: '127.0.0.1', port: 5432, user: 'postgres', password: '', connectionTimeoutMillis: 5000 };

const c = new pg.Client({ ...cfg, database: 'postgres' });
await c.connect();
const dbs = await c.query('SELECT datname FROM pg_database WHERE datistemplate=false');
console.log('DBS:', dbs.rows.map(r=>r.datname).join(', '));
if (!dbs.rows.some(r=>r.datname==='testdb')) { await c.query('CREATE DATABASE testdb'); console.log('CREATED testdb'); }
await c.end();

const t = new pg.Client({ ...cfg, database: 'testdb' });
await t.connect();
await t.query('CREATE SCHEMA IF NOT EXISTS analytics; CREATE SCHEMA IF NOT EXISTS inventory;');
await t.query('CREATE TABLE IF NOT EXISTS public.users(id serial primary key, name text);');
await t.query('CREATE TABLE IF NOT EXISTS analytics.events(id serial primary key, event text);');
await t.query('CREATE TABLE IF NOT EXISTS inventory.products(id serial primary key, sku text);');
await t.query("INSERT INTO public.users(name) SELECT 'alice' WHERE NOT EXISTS (SELECT 1 FROM public.users);");
await t.query("INSERT INTO analytics.events(event) SELECT 'login' WHERE NOT EXISTS (SELECT 1 FROM analytics.events);");
const s = await t.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY 1");
console.log('SCHEMAS:', s.rows.map(r=>r.schema_name).join(', '));
const tb = await t.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public','analytics','inventory') ORDER BY 1,2");
console.log('TABLES:', tb.rows.map(r=>r.table_schema+'.'+r.table_name).join(', '));
await t.end();
console.log('DONE');
process.exit(0);
