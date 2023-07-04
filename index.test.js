const fs = require('fs').promises;
const {
  convertExeOrderStrToArray,
  extractPhaseDirs,
  isOrderIdentical,
  prepareCommand,
  run
} = require('./index');

// --------------
// Test convertExeOrderStrToArray
describe('convertExeOrderStrToArray', () => {
  it('splits a string by a comma and trims whitespaces', () => {
    const str = 'a, b ,c, d ';
    const expectedResult = ['a', 'b', 'c', 'd'];
    const result = convertExeOrderStrToArray(str);
    expect(result).toEqual(expectedResult);
  });

  it('returns an empty arr for an empty string', () => {
    const str = '';
    const expectedResult = [];
    const result = convertExeOrderStrToArray(str);
    expect(result).toEqual(expectedResult);
  });

  it('returns an arr with a single elem for a string without commas', () => {
    const str = 'item1';
    const expectedResult = ['item1'];
    const result = convertExeOrderStrToArray(str);
    expect(result).toEqual(expectedResult);
  });
});

// --------------
// Test extractPhaseDirs
describe('extractPhaseDirs', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('extracts dir names from the main dir', async () => {
    const input = [
      { name: 'dir1', isDirectory: () => true },
      { name: 'dir2', isDirectory: () => true },
      { name: 'file1', isDirectory: () => false }
    ];

    fs.readdir = jest.fn().mockResolvedValueOnce(input);
    const result = await extractPhaseDirs('./path');
    expect(result).toEqual(['dir1', 'dir2']);
    expect(fs.readdir).toHaveBeenCalledWith('./path', { withFileTypes: true });
  });

  it('returns an empty arr when there are no dirs', async () => {
    const mockFiles = [
      { name: 'file1', isDirectory: () => false },
      { name: 'file2', isDirectory: () => false },
    ];

    fs.readdir = jest.fn().mockResolvedValueOnce(mockFiles);
    const result = await extractPhaseDirs('./path');
    expect(result).toEqual([]);
    expect(fs.readdir).toHaveBeenCalledWith('./path', { withFileTypes: true });
  });
});

// --------------
// Test isOrderIdentical
describe('isOrderIdentical', () => {
  it('returns true when the order is identical', () => {
    const arr1 = ['a', 'b', 'c'];
    const arr2 = ['a', 'b', 'c'];

    const result = isOrderIdentical(arr1, arr2);
    expect(result).toBe(true);
  });

  it('returns false when the order is not identical', () => {
    const arr1 = ['a', 'b', 'c'];
    const arr2 = ['c', 'b', 'a'];
    const result = isOrderIdentical(arr1, arr2);
    expect(result).toBe(false);
  });

  it('returns false when arrs have different len', () => {
    const arr1 = ['a', 'b'];
    const arr2 = ['a', 'b', 'c'];
    const result = isOrderIdentical(arr1, arr2);
    expect(result).toBe(false);
  });

  it('returns true when two empty arrs', () => {
    const arr1 = [];
    const arr2 = [];
    const result = isOrderIdentical(arr1, arr2);
    expect(result).toBe(true);
  });
});

// --------------
// Test prepareCommand






