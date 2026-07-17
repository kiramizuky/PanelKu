/**
 * Base Repository — generic CRUD for SQLite-backed models.
 * All models expose the same static API (findById, find, create, etc.)
 * so this base layer delegates to them directly.
 */
export default class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async findById(id, _options = {}) {
    return this.model.findById(id);
  }

  async findOne(filter, _options = {}) {
    return this.model.findOne(filter);
  }

  async findMany(filter = {}, options = {}) {
    const rows = await this.model.find(filter, options.select);
    let result = rows;
    if (options.sort?.createdAt === -1 || options.sort?.created_at === -1) {
      result = result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    if (options.skip) result = result.slice(options.skip);
    if (options.limit) result = result.slice(0, options.limit);
    return result;
  }

  async paginate(filter = {}, page = 1, limit = 20, _options = {}) {
    page  = parseInt(page);
    limit = parseInt(limit);
    const skip  = (page - 1) * limit;
    const all   = await this.model.find(filter);
    const total = all.length;
    const data  = all.slice(skip, skip + limit);
    return { data, total, page, limit };
  }

  async create(data) {
    return this.model.create(data);
  }

  async updateById(id, data, _options = {}) {
    return this.model.findByIdAndUpdate(id, data, { new: true, ..._options });
  }

  async updateOne(filter, data, options = {}) {
    if (this.model.findOneAndUpdate) {
      return this.model.findOneAndUpdate(filter, data, { new: true, ...options });
    }
    const doc = await this.model.findOne(filter);
    if (!doc) return null;
    return this.model.findByIdAndUpdate(doc._id, data, { new: true });
  }

  async deleteById(id) {
    return this.model.findByIdAndDelete(id);
  }

  async deleteMany(filter) {
    return this.model.deleteMany(filter);
  }

  async count(filter = {}) {
    return this.model.countDocuments(filter);
  }

  async exists(filter) {
    const doc = await this.model.findOne(filter);
    return !!doc;
  }
}
