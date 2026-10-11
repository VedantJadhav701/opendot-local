"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Globe, Laptop, Play, Sparkles, Terminal } from "lucide-react";
import { finishSetup, getHealth, installBrowserEngine, startConversation } from "@/app/actions";
import { getModelSetup } from "@/app/model-actions";
import { markRead, useStore } from "@/lib/store";
import type { HealthStatus } from "@/server/health";
import type { ModelManagerState } from "@/server/models/types";
import ModelSetup from "./ModelSetup";

export default function FirstRun() {
  const router = useRouter();
  const dots = useStore((s) => s.dots);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [modelState, setModelState] = useState<ModelManagerState | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [browserInstalling, setBrowserInstalling] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const loadStatus = async () => {
    setChecking(true);
    try {
      const [m, h] = await Promise.all([getModelSetup().catch(() => null), getHealth().catch(() => null)]);
      if (m) setModelState(m);
      if (h) setHealth(h);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const ollamaOk = !!modelState?.connected;
  const modelsInstalled = (modelState?.installed?.length ?? 0) > 0;
  const browserOk = !!health?.browser?.ok;

  const handleInstallBrowser = () => {
    setBrowserInstalling(true);
    setBrowserError(null);
    start(async () => {
      const err = await installBrowserEngine();
      if (err) setBrowserError(err);
      await loadStatus();
      setBrowserInstalling(false);
    });
  };

  const handleCompleteSetup = (promptUrl?: string) => {
    start(async () => {
      await finishSetup();
      const targetDot = dots[0];
      if (promptUrl && targetDot) {
        const prompt = `Summarize ${promptUrl}`;
        const convId = await startConversation(targetDot.id, prompt);
        markRead(targetDot.id);
        router.push(`/dots/${targetDot.id}?c=${convId}`);
      } else if (targetDot) {
        router.push(`/dots/${targetDot.id}`);
      } else {
        router.push("/new");
      }
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[800px] flex-col justify-center px-4 py-12 sm:px-8">
        {/* Step indicator */}
        <div className="mb-8 flex items-center justify-between border-b border-black/[0.06] pb-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-readable text-[13px] font-semibold text-white">
              {step}
            </span>
            <span className="text-[15px] font-medium">
              {step === 1 && "1. Connect Ollama"}
              {step === 2 && "2. Pick & Download Model"}
              {step === 3 && "3. Browser Automation Engine"}
              {step === 4 && "4. Welcome & Try OpenDot"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-caption text-foreground/45">
            Step {step} of 4
          </div>
        </div>

        {/* Step 1: Ollama */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <div className="eyebrow text-brand-readable/80">Local AI Engine</div>
              <h2 className="text-display mt-2">Connect to Ollama</h2>
              <p className="text-body-lg mt-2 text-foreground/65">
                OpenDot-local runs 100% locally on your hardware. Ollama powers local model inference without sending your data to remote servers.
              </p>
            </div>

            <div className="surface rounded-xl p-5">
              <div className="flex items-start gap-4">
                <Laptop className="mt-1 size-5 text-foreground/50 shrink-0" />
                <div className="flex-1">
                  <div className="font-medium text-[15px]">Ollama Local Server</div>
                  <div className="text-body-sm text-foreground/55 mt-1">
                    Expected endpoint: <code className="font-mono text-brand-readable">http://127.0.0.1:11434</code>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className={`size-2 rounded-full ${ollamaOk ? "bg-success" : "bg-warning animate-pulse"}`} />
                    <span className="text-body-sm font-medium">
                      {ollamaOk ? "Ollama connected and ready" : "Ollama not detected or starting…"}
                    </span>
                  </div>
                </div>
              </div>

              {!ollamaOk && (
                <div className="mt-5 border-t border-black/[0.06] pt-4">
                  <p className="text-body-sm text-foreground/70">
                    If you haven&apos;t installed Ollama yet, download and start it now:
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href="https://ollama.com/download"
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary h-9 px-4 text-[13px]"
                    >
                      Download Ollama
                    </a>
                    <button
                      type="button"
                      onClick={loadStatus}
                      disabled={checking}
                      className="btn-secondary h-9 px-4 text-[13px]"
                    >
                      Re-check connection
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!ollamaOk}
                className="btn-primary flex items-center gap-2 h-10 px-5 text-[14px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next: Choose Model <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Model */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <div className="eyebrow text-brand-readable/80">Model Library</div>
              <h2 className="text-display mt-2">Pick your local model</h2>
              <p className="text-body-lg mt-2 text-foreground/65">
                We detected your hardware capabilities below. Download an original Ollama library model that fits your memory.
              </p>
            </div>

            <div className="surface rounded-xl p-5">
              <ModelSetup onChanged={loadStatus} />
            </div>

            <div className="flex items-center justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="btn-secondary flex items-center gap-2 h-10 px-4 text-[14px]"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={!modelsInstalled}
                className="btn-primary flex items-center gap-2 h-10 px-5 text-[14px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next: Browser Engine <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Browser Engine */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <div className="eyebrow text-brand-readable/80">Web Automation</div>
              <h2 className="text-display mt-2">Browser engine verification</h2>
              <p className="text-body-lg mt-2 text-foreground/65">
                Dots read documentation, browse online information, and summarize web pages using your installed browser (Microsoft Edge or Google Chrome) or bundled Chromium.
              </p>
            </div>

            <div className="surface rounded-xl p-5 space-y-4">
              <div className="flex items-start gap-4">
                <Globe className="mt-1 size-5 text-foreground/50 shrink-0" />
                <div className="flex-1">
                  <div className="font-medium text-[15px]">Browser Channel</div>
                  <div className="text-body-sm text-foreground/55 mt-1">
                    Channel: <span className="font-semibold text-foreground/80">{health?.browser?.channel || "Detecting…"}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className={`size-2 rounded-full ${browserOk ? "bg-success" : "bg-warning"}`} />
                    <span className="text-body-sm font-medium">
                      {browserOk ? "Browser engine ready" : "No compatible browser detected"}
                    </span>
                  </div>
                </div>
              </div>

              {!browserOk && (
                <div className="border-t border-black/[0.06] pt-4">
                  <p className="text-body-sm text-foreground/70 mb-3">
                    Click below to install the Chromium browser engine:
                  </p>
                  <button
                    type="button"
                    onClick={handleInstallBrowser}
                    disabled={browserInstalling || pending}
                    className="btn-primary h-9 px-4 text-[13px]"
                  >
                    {browserInstalling ? "Installing Chromium…" : "Install browser engine"}
                  </button>
                  {browserError && (
                    <div className="mt-2 text-caption text-destructive">{browserError}</div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-secondary flex items-center gap-2 h-10 px-4 text-[14px]"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                disabled={!browserOk}
                className="btn-primary flex items-center gap-2 h-10 px-5 text-[14px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next: Try It <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Try it */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <div className="eyebrow text-brand-readable/80">Setup Complete</div>
              <h2 className="text-display mt-2">You are ready to go!</h2>
              <p className="text-body-lg mt-2 text-foreground/65">
                Your environment is completely set up. OpenDot-local is ready to assist you with local file browsing, web research, and reasoning.
              </p>
            </div>

            <div className="surface rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-3 text-success">
                <CheckCircle2 className="size-5" />
                <span className="font-medium text-[15px]">Ollama connected, model installed, browser ready</span>
              </div>
              <p className="text-body-sm text-foreground/65">
                Test your local agent right away by asking it to summarize a web page:
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleCompleteSetup("https://example.com")}
                  disabled={pending}
                  className="btn-primary flex items-center gap-2 h-10 px-5 text-[14px]"
                >
                  <Sparkles className="size-4" /> Summarize https://example.com
                </button>
                <button
                  type="button"
                  onClick={() => handleCompleteSetup()}
                  disabled={pending}
                  className="btn-secondary h-10 px-5 text-[14px]"
                >
                  Go to Dashboard
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="btn-secondary flex items-center gap-2 h-10 px-4 text-[14px]"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
