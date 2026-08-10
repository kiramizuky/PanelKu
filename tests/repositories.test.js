/**
 * Unit test: repositories/base.repository.js — [8.1] Test repositories
 *
 * Strategi:
 * - BaseRepository TIDAK mengimpor dependensi apa pun (pure class, model
 *   di-inject lewat constructor) → import langsung, model di-mock.
 * - Fokus menguji LOGIKA repository: sorting createdAt, skip/limit, paginate,
 *   updateOne fallback (findOne + findByIdAndUpdate), exists, deleteMany.
 * - SQLite asli (better-sqlite3 `:memory:`) tidak dipakai di sini agar test
 *   cepat & deterministik; adapter SQL tetap ter-cover oleh test model-level.
 *
 * @jest-environment node
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import BaseRepository from '../src/repositories/base.repository.js';

const mockModel = {
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  create: jest.fn(),
  deleteMany: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: undefined, // memaksa jalur fallback updateOne
};

const rows = [
  { _id: 'a', name: 'old', createdAt: new Date('2026-01-01T00:00:00Z') },
  { _id: 'b', name: 'mid', createdAt: new Date('2026-02-01T00:00:00Z') },
  { _id: 'c', name: 'new', createdAt: new Date('2026-03-01T00:00:00Z') },
];

let repo;

beforeEach(() => {
  jest.clearAllMocks();
  repo = new BaseRepository(mockModel);
});

describe('BaseRepository', () => {
  test('findById delegates to model.findById', async () => {
    mockModel.findById.mockResolvedValue(rows[0]);
    await expect(repo.findById('a')).resolves.toBe(rows[0]);
    expect(mockModel.findById).toHaveBeenCalledWith('a');
  });

  test('findMany sorts by createdAt desc when requested', async () => {
    mockModel.find.mockResolvedValue([...rows]);
    const result = await repo.findMany({}, { sort: { createdAt: -1 } });
    expect(result.map((r) => r.name)).toEqual(['new', 'mid', 'old']);
  });

  test('findMany sorts by created_at desc (snake_case) too', async () => {
    mockModel.find.mockResolvedValue([...rows]);
    const result = await repo.findMany({}, { sort: { created_at: -1 } });
    expect(result.map((r) => r.name)).toEqual(['new', 'mid', 'old']);
  });

  test('findMany applies skip and limit', async () => {
    mockModel.find.mockResolvedValue([...rows]);
    const result = await repo.findMany({}, { skip: 1, limit: 1 });
    expect(result.map((r) => r.name)).toEqual(['mid']);
  });

  test('findMany passes select option to model.find', async () => {
    mockModel.find.mockResolvedValue([...rows]);
    await repo.findMany({ active: true }, { select: 'name' });
    expect(mockModel.find).toHaveBeenCalledWith({ active: true }, 'name');
  });

  test('paginate returns data slice + total', async () => {
    mockModel.find.mockResolvedValue([...rows]);
    const page1 = await repo.paginate({}, 1, 2);
    expect(page1).toEqual({ data: [rows[0], rows[1]], total: 3, page: 1, limit: 2 });
    const page2 = await repo.paginate({}, 2, 2);
    expect(page2.data.map((r) => r.name)).toEqual(['new']);
  });

  test('paginate handles non-numeric input via parseInt', async () => {
    mockModel.find.mockResolvedValue([...rows]);
    const result = await repo.paginate({}, '1', '2');
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  test('updateOne falls back to findOne + findByIdAndUpdate when model lacks findOneAndUpdate', async () => {
    mockModel.findOne.mockResolvedValue(rows[1]);
    mockModel.findByIdAndUpdate.mockResolvedValue({ ...rows[1], name: 'updated' });
    const result = await repo.updateOne({ name: 'mid' }, { name: 'updated' });
    expect(mockModel.findOne).toHaveBeenCalledWith({ name: 'mid' });
    expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith('b', { name: 'updated' }, { new: true });
    expect(result.name).toBe('updated');
  });

  test('updateOne uses findOneAndUpdate when model provides it', async () => {
    const modelWith = { ...mockModel, findOneAndUpdate: jest.fn().mockResolvedValue({ ok: 1 }) };
    const r = new BaseRepository(modelWith);
    const result = await r.updateOne({ name: 'x' }, { name: 'y' });
    expect(modelWith.findOneAndUpdate).toHaveBeenCalledWith({ name: 'x' }, { name: 'y' }, { new: true });
    expect(result).toEqual({ ok: 1 });
  });

  test('updateOne returns null when doc not found (fallback path)', async () => {
    mockModel.findOne.mockResolvedValue(null);
    await expect(repo.updateOne({ name: 'nope' }, { name: 'x' })).resolves.toBeNull();
  });

  test('updateById passes { new: true }', async () => {
    mockModel.findByIdAndUpdate.mockResolvedValue(rows[0]);
    await repo.updateById('a', { name: 'x' });
    expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith('a', { name: 'x' }, { new: true });
  });

  test('create, deleteById, deleteMany, count delegate to model', async () => {
    mockModel.create.mockResolvedValue({ _id: 'd' });
    await expect(repo.create({ name: 'x' })).resolves.toEqual({ _id: 'd' });

    mockModel.findByIdAndDelete.mockResolvedValue(true);
    await repo.deleteById('a');
    expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith('a');

    mockModel.deleteMany.mockResolvedValue({ deleted: 2 });
    await repo.deleteMany({ isActive: false });
    expect(mockModel.deleteMany).toHaveBeenCalledWith({ isActive: false });

    mockModel.countDocuments.mockResolvedValue(3);
    await expect(repo.count({})).resolves.toBe(3);
  });

  test('exists returns true when doc found, false otherwise', async () => {
    mockModel.findOne.mockResolvedValueOnce(rows[0]).mockResolvedValueOnce(null);
    await expect(repo.exists({ name: 'old' })).resolves.toBe(true);
    await expect(repo.exists({ name: 'nope' })).resolves.toBe(false);
  });
});
