/**
 * lineBuffer — split a stream of arbitrarily-chunked stdout data into complete
 * newline-delimited lines. Holds a partial trailing line across chunks; `flush`
 * emits any remaining buffered content (called on stream end).
 */
export class LineBuffer {
  private buf = "";

  /** Feed a chunk; returns the complete lines it produced (without newlines). */
  push(chunk: string): string[] {
    this.buf += chunk;
    const lines: string[] = [];
    let idx = this.buf.indexOf("\n");
    while (idx !== -1) {
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      if (line.length > 0) lines.push(line);
      this.buf = this.buf.slice(idx + 1);
      idx = this.buf.indexOf("\n");
    }
    return lines;
  }

  /** Emit any remaining buffered content (final partial line). */
  flush(): string[] {
    const remaining = this.buf.replace(/\r$/, "");
    this.buf = "";
    return remaining.length > 0 ? [remaining] : [];
  }
}
