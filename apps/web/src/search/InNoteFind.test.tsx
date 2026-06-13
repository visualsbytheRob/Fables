// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper } from '../test-utils/wrappers.js';
import { InNoteFind, findMatches } from './InNoteFind.js';

const BODY = 'The quick brown fox jumps over the lazy dog. The fox is cunning.';

describe('findMatches pure function', () => {
  it('finds all occurrences of a substring (case-insensitive)', () => {
    const matches = findMatches(BODY, 'fox');
    expect(matches).toHaveLength(2);
    expect(BODY.slice(matches[0], matches[0]! + 3)).toBe('fox');
    expect(BODY.slice(matches[1], matches[1]! + 3)).toBe('fox');
  });

  it('returns empty array for empty query', () => {
    expect(findMatches(BODY, '')).toEqual([]);
    expect(findMatches(BODY, '  ')).toEqual([]);
  });

  it('returns empty array when no match', () => {
    expect(findMatches(BODY, 'dragon')).toEqual([]);
  });
});

describe('InNoteFind component (F714)', () => {
  it('shows match count for found text', async () => {
    render(
      <InNoteFind body={BODY} open={true} onClose={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    const input = screen.getByLabelText('Find text in note');
    fireEvent.change(input, { target: { value: 'fox' } });

    await waitFor(() => {
      expect(screen.getByText('1/2')).toBeDefined();
    });
  });

  it('cycles to next match', async () => {
    render(
      <InNoteFind body={BODY} open={true} onClose={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    const input = screen.getByLabelText('Find text in note');
    fireEvent.change(input, { target: { value: 'fox' } });

    await waitFor(() => expect(screen.getByText('1/2')).toBeDefined());

    fireEvent.click(screen.getByLabelText('Next match'));
    await waitFor(() => expect(screen.getByText('2/2')).toBeDefined());

    // Wraps around
    fireEvent.click(screen.getByLabelText('Next match'));
    await waitFor(() => expect(screen.getByText('1/2')).toBeDefined());
  });

  it('shows 0/0 for no match', async () => {
    render(
      <InNoteFind body={BODY} open={true} onClose={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    const input = screen.getByLabelText('Find text in note');
    fireEvent.change(input, { target: { value: 'dragon' } });

    await waitFor(() => expect(screen.getByText('0/0')).toBeDefined());
  });

  it('calls onClose when X is clicked', () => {
    const onClose = vi.fn();
    render(
      <InNoteFind body={BODY} open={true} onClose={onClose} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByLabelText('Close find'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when open=false', () => {
    render(
      <InNoteFind body={BODY} open={false} onClose={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    expect(screen.queryByLabelText('Find text in note')).toBeNull();
  });
});
