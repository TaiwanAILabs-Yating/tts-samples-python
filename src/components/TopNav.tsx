import { useNavigate, useLocation } from "react-router-dom";

interface TopNavProps {
  projectName?: string;
}

export function TopNav({ projectName }: TopNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isSetup = location.pathname === "/setup";

  return (
    <header className="flex items-center justify-between h-14 px-6 bg-bg-nav border-b border-border shrink-0">
      {/* Left */}
      <div className="flex items-center gap-6">
        {isSetup ? (
          <span className="text-text-secondary text-sm font-medium">
            New Project
          </span>
        ) : (
          <button className="flex items-center gap-1.5 text-sm font-medium text-text-primary px-3 py-1.5 rounded-md hover:bg-bg-tertiary transition-colors">
            {projectName || "My Project"}
            <svg
              className="w-3.5 h-3.5 text-text-secondary"
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
            onClick={() => navigate("/setup")}
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
