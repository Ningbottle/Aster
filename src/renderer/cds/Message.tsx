/* Adapted from Caho1/open-claude-ui, code-examples/ChatMessageBubbles.tsx, MIT, commit c1f923ae0051a871941b98a0e2e3183a545e6a85. */
import type { ReactNode } from 'react';

export interface MessageContainerProps {
  children: ReactNode;
  id?: string | number;
}

export function UserMessageBubble({ children, id }: MessageContainerProps) {
  return (
    <div id={id === undefined ? undefined : String(id)} data-cds="UserMessage" className="user-message-row">
      <div className="user-message-bubble">{children}</div>
    </div>
  );
}

export function AssistantMessage({ children, id }: MessageContainerProps) {
  return (
    <div id={id === undefined ? undefined : String(id)} data-cds="AssistantMessage" className="assistant-message">
      {children}
    </div>
  );
}
