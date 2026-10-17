import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LiveDuration } from "./LiveDuration";
import { useNow } from "@/lib/run/useNow";


function Clock({ enabled, start }: { enabled: boolean; start: number }) {
  const now = useNow(1_000, enabled);
  return <LiveDuration startedAtMs={start} nowMs={now} ticking={enabled} />;
}

describe("useNow / LiveDuration (W-2)", () => {
  afterEach(() => vi.useRealTimers());

  it("ticks once per second only while live", () => {
    vi.useFakeTimers();
    const start = Date.now();
    const { container, rerender } = render(<Clock enabled start={start} />);
    expect(container.textContent).toBe("0:00");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(container.textContent).toBe("0:01");
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(container.textContent).toBe("0:03");
    rerender(<Clock enabled={false} start={start} />);
    const frozen = container.textContent;
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(container.textContent).toBe(frozen);
  });

  it("history renders a frozen m:ss from endedAt", () => {
    render(<LiveDuration startedAtMs={0} endedAtMs={72_000} nowMs={999_999_999} ticking={false} />);
    expect(screen.getByText("1:12")).toBeTruthy();
  });

  it("no start -> em dash", () => {
    const { container } = render(<LiveDuration startedAtMs={null} nowMs={0} ticking />);
    expect(container.textContent).toBe("—");
  });
});
