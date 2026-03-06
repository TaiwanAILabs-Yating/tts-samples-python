import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../stores/project-store.ts";

interface TopNavProps {
  projectName?: string;
}

export function TopNav({ projectName }: TopNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isSetup = location.pathname === "/setup";

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const projectId = useProjectStore((s) => s.projectId);
  const savedProjects = useProjectStore((s) => s.savedProjects);
  const switchProject = useProjectStore((s) => s.switchProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!switcherOpen) return;
    const handler = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [switcherOpen]);

  // Combine current project + saved projects for display
  const currentState = useProjectStore.getState();
  const allProjects = [
    // Current active project (always shown)
    {
      id: projectId,
      projectName: projectName || "My Project",
      sentences: currentState.sentences,
      isCurrent: true,
    },
    // Other saved projects (exclude current)
    ...savedProjects
      .filter((p) => p.id !== projectId)
      .map((p) => ({
        id: p.id,
        projectName: p.projectName,
        sentences: p.sentences,
        isCurrent: false,
      })),
  ];

  const getStatusColor = (sentences: { status: string }[]) => {
    if (sentences.length === 0) return "#6B7280"; // gray - no sentences
    const allApproved = sentences.every((s) => s.status === "approved");
    if (allApproved) return "#10B981"; // green
    const hasApproved = sentences.some((s) => s.status === "approved");
    if (hasApproved) return "#F59E0B"; // yellow - partial
    return "#6B7280"; // gray
  };

  return (
    <header className="flex items-center justify-between h-14 px-6 bg-bg-nav border-b border-border shrink-0">
      {/* Left */}
      <div className="flex items-center gap-6">
        {isSetup ? (
          <span className="text-text-secondary text-sm font-medium">
            New Project
          </span>
        ) : (
          <div className="relative" ref={switcherRef}>
            <button
              onClick={() => setSwitcherOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-text-primary px-3 py-1.5 rounded-md hover:bg-bg-tertiary transition-colors"
            >
              {projectName || "My Project"}
              <svg
                className={`w-3.5 h-3.5 text-text-secondary transition-transform ${switcherOpen ? "rotate-180" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {/* Dropdown */}
            {switcherOpen && (
              <div className="absolute top-full left-0 mt-1 w-[280px] bg-bg-secondary border border-border rounded-lg p-1 z-50 shadow-lg shadow-black/30">
                {/* Header */}
                <div className="px-3 py-2">
                  <span className="text-xs font-semibold text-text-muted tracking-wide uppercase">
                    Switch Project
                  </span>
                </div>
                <div className="h-px bg-border mx-1 mb-1" />

                {/* Project list */}
                <div className="flex flex-col gap-0.5 max-h-[240px] overflow-y-auto">
                  {allProjects.map((proj) => (
                    <div
                      key={proj.id}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                        proj.isCurrent
                          ? "bg-accent-primary/10"
                          : "hover:bg-bg-tertiary"
                      }`}
                      onClick={() => {
                        if (!proj.isCurrent) {
                          switchProject(proj.id);
                          setSwitcherOpen(false);
                        }
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: getStatusColor(proj.sentences) }}
                        />
                        <span
                          className={`text-[13px] truncate ${
                            proj.isCurrent
                              ? "font-medium text-text-primary"
                              : "text-text-secondary"
                          }`}
                        >
                          {proj.projectName}
                        </span>
                      </div>
                      {!proj.isCurrent && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteProject(proj.id);
                          }}
                          className="p-1 rounded hover:bg-bg-secondary transition-colors shrink-0"
                          title="Delete project"
                        >
                          <svg
                            className="w-3.5 h-3.5 text-text-muted hover:text-status-rejected"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* New Project */}
                <div className="h-px bg-border mx-1 mt-1" />
                <button
                  onClick={() => {
                    useProjectStore.getState().reset();
                    navigate("/setup");
                    setSwitcherOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2.5 rounded-md text-accent-primary hover:bg-bg-tertiary transition-colors mt-0.5"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                  <span className="text-[13px] font-medium">New Project</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {isSetup ? (
          <button
            onClick={() => navigate("/workspace")}
            className="flex items-center gap-1.5 text-sm font-medium text-text-secondary px-4 py-1.5 rounded-md border border-border-secondary hover:bg-bg-tertiary transition-colors"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => {
              useProjectStore.getState().reset();
              navigate("/setup");
            }}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-accent-primary hover:bg-accent-hover px-3 py-1.5 rounded-md transition-colors"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            New Project
          </button>
        )}
      </div>
    </header>
  );
}
