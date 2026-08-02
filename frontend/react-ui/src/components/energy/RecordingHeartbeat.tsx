import React from 'react';
import { RecordingDescriptor } from '../../lib/freshness';

/**
 * The recording heartbeat. Recording is sacred and always visible: a whisper
 * while healthy, the loudest thing on the surface when it breaks. The exact
 * timestamps stay in diagnostics — here the state is a feeling and a reason.
 */
export function RecordingHeartbeat({ descriptor }: { descriptor: RecordingDescriptor }) {
  const healthy = descriptor.healthy;
  return (
    <div
      className={`heartbeat ${healthy ? 'heartbeat--healthy' : 'heartbeat--warn'}`}
      role="status"
      data-testid="recording-heartbeat"
      data-state={descriptor.state}
    >
      <span className="heartbeat__dot" aria-hidden="true" />
      <span className="heartbeat__label">{descriptor.label}</span>
      {descriptor.detail && <span className="heartbeat__detail">{descriptor.detail}</span>}
    </div>
  );
}
