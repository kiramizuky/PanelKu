import express from 'express';
import expressEjsLayouts from 'express-ejs-layouts';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'src/views'));
app.use(expressEjsLayouts);
app.set('layout', 'layout'); 
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

app.get('/test', (req, res) => {
  res.render('dashboard/index', { title: 'Dashboard' }, (err, html) => {
    if (err) {
      console.error('RENDER ERROR:', err);
      process.exit(1);
    } else {
      console.log('RENDER SUCCESS, length:', html.length);
      process.exit(0);
    }
  });
});

app.listen(3001, () => {
  import('http').then(http => {
    http.get('http://localhost:3001/test', (res) => {});
  });
});
