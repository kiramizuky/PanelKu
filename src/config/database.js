import 'dotenv/config';
import { resolve } from 'path';

export default {
  path: resolve(process.cwd(), 'storage', 'panelku.db'),
};
