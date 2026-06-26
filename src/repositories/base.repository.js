/**
 * Base Repository — generic CRUD operations for Mongoose models.
 * Extend this for model-specific repositories.
 */
export default class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async findById(id, options = {}) {
    return this.model.findById(id, options.select, options).populate(options.populate || []);
  }

  async findOne(filter, options = {}) {
    return this.model.findOne(filter, options.select, options).populate(options.populate || []);
  }

  async findMany(filter = {}, options = {}) {
    const query = this.model.find(filter, options.select);
    if (options.populate) query.populate(options.populate);
    if (options.sort) query.sort(options.sort);
    if (options.limit) query.limit(parseInt(options.limit));
    if (options.skip) query.skip(parseInt(options.skip));
    return query.exec();
  }

  async paginate(filter = {}, page = 1, limit = 20, options = {}) {
    page = parseInt(page);
    limit = parseInt(limit);
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.findMany(filter, { ...options, limit, skip }),
      this.model.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  async create(data) {
    const doc = new this.model(data);
    return doc.save();
  }

  async updateById(id, data, options = { new: true, runValidators: true }) {
    return this.model.findByIdAndUpdate(id, data, options);
  }

  async updateOne(filter, data, options = { new: true, runValidators: true }) {
    return this.model.findOneAndUpdate(filter, data, options);
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
    return this.model.exists(filter);
  }
}
