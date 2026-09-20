"use client";
import { useState } from "react";
import type { NavData } from "@/lib/chain";
import { Icon } from "./ui";

export function NavHistory({ history }: { history: NavData["history"] }) {
  const [selected, setSelected] = useState(history.length - 1);
  if (!history.length)
    return <div className="data-empty">No published observations yet.</div>;
  const index = Math.max(0, Math.min(selected, history.length - 1));
  const observation = history[index]!;
  const values = history.map((h) => Number(h.nav));
  const low = Math.min(...values),
    high = Math.max(...values);
  const padding = Math.max(high - low, Math.abs(high) * 0.002, 0.000002) / 2;
  const floor = Math.max(0, low - padding),
    ceiling = high + padding;
  const firstDate = Date.parse(history[0]!.date),
    lastDate = Date.parse(history.at(-1)!.date);
  const points = history.map((h) => ({
    x:
      firstDate === lastDate
        ? 300
        : 12 +
          ((Date.parse(h.date) - firstDate) / (lastDate - firstDate)) * 576,
    y: 156 - ((Number(h.nav) - floor) / (ceiling - floor)) * 132,
  }));
  const point = points[index]!;
  const format = (value: string | number) =>
    Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    });
  return (
    <>
      <div className="nav-observation" aria-live="polite" aria-atomic="true">
        <strong>
          {format(observation.nav)} <small>USDC</small>
        </strong>
        <span>
          <time dateTime={observation.date}>{observation.date}</time>
          <span className="mono">#{observation.block}</span>
        </span>
      </div>
      <div
        className="history-plot"
        role="group"
        aria-label="Published NAV history"
        tabIndex={history.length > 1 ? 0 : undefined}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          setSelected(
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? history.length - 1
                : Math.max(
                    0,
                    Math.min(
                      history.length - 1,
                      index + (e.key === "ArrowRight" ? 1 : -1),
                    ),
                  ),
          );
        }}
      >
        <svg
          viewBox="0 0 600 180"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${history.length} published NAV observation${history.length === 1 ? "" : "s"}. ${history[0]!.date} to ${history.at(-1)!.date}. Values in USDC per hbTRS.`}
          onPointerMove={(e) => {
            if (history.length < 2 || e.pointerType !== "mouse") return;
            const bounds = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - bounds.left) / bounds.width) * 600;
            setSelected(
              points.reduce(
                (nearest, p, i) =>
                  Math.abs(p.x - x) < Math.abs(points[nearest]!.x - x)
                    ? i
                    : nearest,
                0,
              ),
            );
          }}
        >
          {[24, 90, 156].map((y) => (
            <line
              key={y}
              x1="0"
              x2="600"
              y1={y}
              y2={y}
              className="chart-gridline"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {history.length > 1 && (
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              className="chart-line"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <line
            x1={point.x}
            x2={point.x}
            y1="16"
            y2="164"
            className="chart-crosshair"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => (
            <circle
              key={`${history[i]!.date}-${i}`}
              cx={p.x}
              cy={p.y}
              r={i === index ? 5 : 3}
              className={i === index ? "chart-point selected" : "chart-point"}
            />
          ))}
        </svg>
        <div className="chart-scale mono" aria-hidden="true">
          <span>{format(ceiling)}</span>
          <span>{format((floor + ceiling) / 2)}</span>
          <span>{format(floor)}</span>
        </div>
      </div>
      <div className="history-dates mono">
        <span>{history[0]!.date}</span>
        <span>
          {history.length > 1 ? history.at(-1)!.date : "FIRST PUBLICATION"}
        </span>
      </div>
      <div className="history-caption">
        <p>
          {history.length === 1
            ? "One published observation. Daily publications build the history."
            : "Published observations · USDC per hbTRS"}
        </p>
        {history.length > 1 && (
          <div className="history-controls">
            <button
              className="secondary"
              aria-label="Previous NAV observation"
              disabled={index === 0}
              onClick={() => setSelected(index - 1)}
            >
              ←
            </button>
            <button
              className="secondary"
              aria-label="Next NAV observation"
              disabled={index === history.length - 1}
              onClick={() => setSelected(index + 1)}
            >
              →
            </button>
          </div>
        )}
      </div>
      <details className="inspect-details history-records">
        <summary>
          View observations <Icon name="chevron" />
        </summary>
        <div
          className="inspect-scroll"
          tabIndex={0}
          role="region"
          aria-label="NAV observations"
        >
          <table className="inspect-table">
            <thead>
              <tr>
                <th scope="col">Valuation date</th>
                <th scope="col">NAV / token</th>
                <th scope="col">Block</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={`${h.date}-${h.block}`}>
                  <td className="mono">{h.date}</td>
                  <td className="mono">{format(h.nav)} USDC</td>
                  <td className="mono">{h.block}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
