import { lazy, useState } from "react";
import type React from "react";
import type { WorkingPlugin } from "./composer/composerTypes.js";
import { useQuickChatContext } from "./QuickChatContext.js";
const DesktopComposer = lazy(() => import("./composer/DesktopComposer.js").then(module => ({ default: module.DesktopComposer })));

const WORKING_COMPOSER_PLACEHOLDER = "使用 CodePilotX Working";

export function WorkingNewSessionView(): React.ReactNode {
  const { composerProps } = useQuickChatContext();
  const [workingPlugin, setWorkingPlugin] = useState<WorkingPlugin | null>(
    null,
  );

  return (
    <div className="quick-chat-workspace working-chat-workspace">
      <main className="quick-chat-view working-chat-view">
        <section className="quick-chat-composer-region tw:justify-start">
          <div className="quick-chat-hero working-chat-hero tw:gap-0">
            <h1>我们该处理什么工作？</h1>
          </div>
          <div
            className="working-composer-interaction tw:flex tw:w-full tw:flex-col tw:items-center tw:gap-3"
          >
            {composerProps ? (
              <div className="chat-composer">
                <DesktopComposer
                  {...composerProps}
                  surface="working"
                  workingPlugin={workingPlugin}
                  onWorkingPluginChange={setWorkingPlugin}
                  placeholder={WORKING_COMPOSER_PLACEHOLDER}
                />
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
