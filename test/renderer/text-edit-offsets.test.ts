import { describe, it, expect } from 'vitest'
import { computeTextEdit, adjustOffset, adjustRange } from '../../src/renderer/utils/text-edit-offsets'

describe('computeTextEdit', () => {
  it('returns null for identical text', () => {
    expect(computeTextEdit('hello', 'hello')).toBeNull()
  })

  it('diffs a pure insertion as a zero-width replacement', () => {
    // "hello world" -> "hello brave world": insert "brave " at cp 6
    expect(computeTextEdit('hello world', 'hello brave world')).toEqual({
      start: 6,
      oldEnd: 6,
      newEnd: 12
    })
  })

  it('diffs a pure deletion', () => {
    // delete "brave " (cp 6..12) from the longer string
    expect(computeTextEdit('hello brave world', 'hello world')).toEqual({
      start: 6,
      oldEnd: 12,
      newEnd: 6
    })
  })

  it('diffs a replacement', () => {
    // "teh cat" -> "the cat": shared leading 't', then "eh" (cp 1..3) becomes
    // "he", shared trailing " cat".
    expect(computeTextEdit('teh cat', 'the cat')).toEqual({
      start: 1,
      oldEnd: 3,
      newEnd: 3
    })
  })

  it('works in codepoints, not UTF-16 code units', () => {
    // A leading emoji is 2 UTF-16 units but 1 codepoint. Inserting "!" after
    // it must report cp index 1, not 2.
    const edit = computeTextEdit('😀ab', '😀!ab')!
    expect(edit.start).toBe(1)
    expect(edit.oldEnd).toBe(1)
    expect(edit.newEnd).toBe(2)
  })
})

describe('adjustRange — the transcript-editor bug', () => {
  it('moves a code that sits entirely AFTER an insertion (the reported bug)', () => {
    // Code on cp 10..20. Insert 5 chars at cp 5 (before the code).
    const edit = { start: 5, oldEnd: 5, newEnd: 10 }
    expect(adjustRange(10, 20, edit)).toEqual({ start: 15, end: 25 })
  })

  it('grows a code when text is inserted INSIDE it (fixing a typo)', () => {
    // Code on cp 10..20. Insert 3 chars at cp 15.
    const edit = { start: 15, oldEnd: 15, newEnd: 18 }
    expect(adjustRange(10, 20, edit)).toEqual({ start: 10, end: 23 })
  })

  it('shrinks a code when text is deleted INSIDE it', () => {
    // Code on cp 10..20. Delete cp 15..18.
    const edit = { start: 15, oldEnd: 18, newEnd: 15 }
    expect(adjustRange(10, 20, edit)).toEqual({ start: 10, end: 17 })
  })

  it('leaves a code that sits entirely BEFORE the edit untouched', () => {
    const edit = { start: 50, oldEnd: 50, newEnd: 60 }
    expect(adjustRange(10, 20, edit)).toEqual({ start: 10, end: 20 })
  })

  it('drops a code whose text was entirely deleted', () => {
    // Code on cp 10..20. Delete cp 8..25 (engulfs the whole code).
    const edit = { start: 8, oldEnd: 25, newEnd: 8 }
    expect(adjustRange(10, 20, edit)).toBeNull()
  })

  it('clamps a code whose start was deleted but tail survives', () => {
    // Code on cp 10..20. Delete cp 8..15 (eats the front of the code).
    const edit = { start: 8, oldEnd: 15, newEnd: 8 }
    // start (inside) clamps to edit.start=8; end 20 -> 20-7=13.
    expect(adjustRange(10, 20, edit)).toEqual({ start: 8, end: 13 })
  })
})

describe('adjustOffset boundary behaviour', () => {
  it('an insertion exactly at a range end does not extend it (right gravity)', () => {
    const edit = { start: 20, oldEnd: 20, newEnd: 23 }
    expect(adjustOffset(20, edit, 'end')).toBe(20)
  })

  it('an insertion exactly at a range start is absorbed into it (left gravity)', () => {
    const edit = { start: 10, oldEnd: 10, newEnd: 13 }
    expect(adjustOffset(10, edit, 'start')).toBe(10)
  })
})
