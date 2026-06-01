import { describe, it, expect, beforeEach } from 'vitest';
import { Repository, RepoError } from '../core/repository.js';

let repo;
let userId;
let accountId;

beforeEach(() => {
  repo = new Repository();
  const user = repo.createUser('notes@example.com', 'secret123');
  userId = user.id;
  accountId = repo.createAccount(userId, { name: 'Main' }).id;
});

describe('daily journal notes', () => {
  it('returns an empty string when no note exists', () => {
    expect(repo.getDailyNote(userId, accountId, '2024-03-04')).toBe('');
  });

  it('upserts and reads back a note', () => {
    repo.setDailyNote(userId, accountId, '2024-03-04', 'Chased a breakout, sized too big.');
    expect(repo.getDailyNote(userId, accountId, '2024-03-04')).toBe('Chased a breakout, sized too big.');
  });

  it('overwrites an existing note', () => {
    repo.setDailyNote(userId, accountId, '2024-03-04', 'first');
    repo.setDailyNote(userId, accountId, '2024-03-04', 'second');
    expect(repo.getDailyNote(userId, accountId, '2024-03-04')).toBe('second');
  });

  it('clears a note when set to empty/whitespace', () => {
    repo.setDailyNote(userId, accountId, '2024-03-04', 'something');
    repo.setDailyNote(userId, accountId, '2024-03-04', '   ');
    expect(repo.getDailyNote(userId, accountId, '2024-03-04')).toBe('');
    expect(repo.listNotedDays(userId, accountId)).toEqual([]);
  });

  it('lists only the days that have notes', () => {
    repo.setDailyNote(userId, accountId, '2024-03-04', 'a');
    repo.setDailyNote(userId, accountId, '2024-03-06', 'b');
    expect(repo.listNotedDays(userId, accountId).sort()).toEqual(['2024-03-04', '2024-03-06']);
  });

  it('survives a re-import (notes are keyed by date, not trade id)', () => {
    repo.setDailyNote(userId, accountId, '2024-03-04', 'keep me');
    repo.saveImport(userId, accountId, [], []); // wipes trades/executions
    expect(repo.getDailyNote(userId, accountId, '2024-03-04')).toBe('keep me');
  });

  it('enforces RLS — another user cannot read or write the note', () => {
    repo.setDailyNote(userId, accountId, '2024-03-04', 'private');
    const other = repo.createUser('intruder@example.com', 'secret123');
    expect(() => repo.getDailyNote(other.id, accountId, '2024-03-04')).toThrow(RepoError);
    expect(() => repo.setDailyNote(other.id, accountId, '2024-03-04', 'hacked')).toThrow(RepoError);
    // original note untouched
    expect(repo.getDailyNote(userId, accountId, '2024-03-04')).toBe('private');
  });
});
