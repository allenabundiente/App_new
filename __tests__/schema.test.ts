import {SCHEMA, splitStatements} from '../src/db/schema';

describe('splitStatements', () => {
  it('splits the real schema into whole, valid-looking statements', () => {
    const stmts = splitStatements(SCHEMA);
    expect(stmts.length).toBeGreaterThan(10);
    for (const s of stmts) {
      // Every statement must be a complete CREATE … — if a comment's
      // semicolon ever leaks into the split, the fragment would fail to
      // start with CREATE and SQLite would reject it as incomplete input.
      expect(s).toMatch(/^CREATE /i);
    }
  });

  it('ignores semicolons inside -- comments (regression for "incomplete input")', () => {
    const sql = [
      'CREATE TABLE t (a TEXT);',
      '-- note with a semicolon; should not split',
      'CREATE INDEX idx ON t(a);',
      'CREATE TABLE u (b TEXT); -- trailing; comment',
    ].join('\n');
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toMatch(/^CREATE TABLE t/);
    expect(stmts[1]).toMatch(/^CREATE INDEX/);
    expect(stmts[2]).toMatch(/^CREATE TABLE u/);
    expect(stmts[2]).not.toContain('comment');
  });

  it('keeps statements with single-quoted strings intact', () => {
    const sql = "CREATE TABLE t (a TEXT NOT NULL DEFAULT '');";
    expect(splitStatements(sql)).toEqual(["CREATE TABLE t (a TEXT NOT NULL DEFAULT '')"]);
  });
});
