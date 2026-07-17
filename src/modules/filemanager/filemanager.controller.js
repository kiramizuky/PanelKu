import fileManagerService from './filemanager.service.js';
import { success, error } from '../../helpers/response.js';
import { createReadStream } from 'fs';

class FileManagerController {
  async list(req, res) {
    try {
      const { path: dirPath = '/' } = req.query;
      const items = await fileManagerService.list(dirPath);
      return success(res, { path: dirPath, items });
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async info(req, res) {
    try {
      const { path: filePath } = req.query;
      const info = await fileManagerService.getInfo(filePath);
      return success(res, info);
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async readFile(req, res) {
    try {
      const { path: filePath } = req.query;
      const content = await fileManagerService.readFile(filePath);
      return success(res, { content, path: filePath });
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async writeFile(req, res) {
    try {
      const { path: filePath, content } = req.body;
      await fileManagerService.writeFile(filePath, content);
      return success(res, {}, 'File saved');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async rename(req, res) {
    try {
      const { path: oldPath, newName } = req.body;
      await fileManagerService.rename(oldPath, newName);
      return success(res, {}, 'Renamed successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async move(req, res) {
    try {
      const { source, destination } = req.body;
      await fileManagerService.move(source, destination);
      return success(res, {}, 'Moved successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async copy(req, res) {
    try {
      const { source, destination } = req.body;
      await fileManagerService.copy(source, destination);
      return success(res, {}, 'Copied successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async delete(req, res) {
    try {
      const { path: targetPath } = req.body;
      await fileManagerService.delete(targetPath);
      return success(res, {}, 'Deleted successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async mkdir(req, res) {
    try {
      const { path: dirPath } = req.body;
      await fileManagerService.mkdir(dirPath);
      return success(res, {}, 'Directory created');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async upload(req, res) {
    try {
      if (!req.files?.length) return error(res, 'No files uploaded', 400);
      return success(res, {
        uploaded: req.files.map((f) => ({ name: f.originalname, size: f.size })),
      }, `${req.files.length} file(s) uploaded`);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async download(req, res) {
    try {
      const { path: filePath } = req.query;
      const full = fileManagerService._resolvePath(filePath);

      // [HIGH-2 FIX] Check if target exists and is a regular file before streaming.
      // createReadStream() on a directory throws EISDIR which is an uncaught crash risk.
      const { stat } = await import('fs/promises');
      const stats = await stat(full);
      if (stats.isDirectory()) {
        return error(res, 'Cannot download a directory directly. Please compress it first.', 400);
      }

      // Sanitize filename to prevent Content-Disposition header injection
      const filename = filePath.split('/').pop().replace(/[\r\n"]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', stats.size);
      createReadStream(full).pipe(res);
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async zip(req, res) {
    try {
      const { path: targetPath, output } = req.body;
      await fileManagerService.zip(targetPath, output);
      return success(res, {}, 'Zipped successfully');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async unzip(req, res) {
    try {
      const { path: zipPath, destination } = req.body;
      await fileManagerService.unzip(zipPath, destination);
      return success(res, {}, 'Extracted successfully');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async search(req, res) {
    try {
      const { path: dirPath = '/', query } = req.query;
      if (!query) return error(res, 'Search query required', 400);
      const results = await fileManagerService.search(dirPath, query);
      return success(res, { results });
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }
}

const fileManagerController = new FileManagerController();
export default fileManagerController;
