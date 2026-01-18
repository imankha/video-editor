import { useState, useEffect } from 'react';
import { Download, Check, X, ChevronUp, ChevronDown, Loader } from 'lucide-react';
import { useExportStore } from '../stores/exportStore';
import { toast } from './shared';

/**
 * GlobalExportIndicator - Persistent indicator for active exports
 *
 * TRUE MVC ARCHITECTURE:
 * - Store is populated from backend via useExportRecovery on app load
 * - WebSocket pushes real-time updates to store
 * - This component simply renders what's in the store
 * - NO polling/sync needed - WebSocket handles everything
 *
 * @see PARALLEL_EXPORT_PLAN.md for architecture details
 */
export function GlobalExportIndicator() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [completedExports, setCompletedExports] = useState([]);

  // Get export state from store (updated via WebSocket)
  const activeExports = useExportStore((state) => state.activeExports);
  const removeExport = useExportStore((state) => state.removeExport);

  // Filter to get only processing exports
  const processingExports = Object.values(activeExports).filter(
    (exp) => exp.status === 'pending' || exp.status === 'processing'
  );

  // Debug logging when count changes
  if (processingExports.length > 0) {
    console.log(`[GlobalExportIndicator] ${processingExports.length} active exports:`,
      processingExports.map(e => `${e.exportId} (${e.status})`).join(', '));
  }

  // Filter to get recent completed/failed exports (last 10 seconds)
  const recentCompletedExports = Object.values(activeExports).filter((exp) => {
    if (exp.status !== 'complete' && exp.status !== 'error') return false;
    const completedTime = new Date(exp.completedAt).getTime();
    const now = Date.now();
    return now - completedTime < 10000; // 10 seconds
  });

  // Show toast notification when export completes
  useEffect(() => {
    const newlyCompleted = recentCompletedExports.filter(
      (exp) => !completedExports.includes(exp.exportId)
    );

    newlyCompleted.forEach((exp) => {
      const projectLabel = exp.projectName || `Project #${exp.projectId}`;
      if (exp.status === 'complete') {
        toast.success('Export Complete', {
          message: `${projectLabel} - ${exp.type} export finished successfully`,
          duration: 5000,
        });
      } else if (exp.status === 'error') {
        toast.error('Export Failed', {
          message: `${projectLabel} - ${exp.error || 'An error occurred during export'}`,
          duration: 8000,
        });
      }
    });

    if (newlyCompleted.length > 0) {
      setCompletedExports((prev) => [
        ...prev,
        ...newlyCompleted.map((exp) => exp.exportId),
      ]);
    }
  }, [recentCompletedExports, completedExports]);

  // Clean up old completed export IDs from tracking
  useEffect(() => {
    const interval = setInterval(() => {
      setCompletedExports((prev) => {
        // Keep only IDs that still exist in store
        return prev.filter((id) => activeExports[id]);
      });
    }, 30000); // Clean up every 30 seconds

    return () => clearInterval(interval);
  }, [activeExports]);

  // Get the most recent processing export for the mini view
  const primaryExport = processingExports.sort(
    (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
  )[0];

  // Don't render if no active exports
  if (processingExports.length === 0) {
    return null;
  }

  const handleDismiss = (exportId) => {
    removeExport(exportId);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'complete':
        return <Check className="w-4 h-4 text-green-400" />;
      case 'error':
        return <X className="w-4 h-4 text-red-400" />;
      default:
        return <Loader className="w-4 h-4 text-blue-400 animate-spin" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'complete':
        return 'bg-green-500/20 border-green-500/50';
      case 'error':
        return 'bg-red-500/20 border-red-500/50';
      default:
        return 'bg-blue-500/20 border-blue-500/50';
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Main indicator card */}
      <div
        className={`bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden transition-all duration-200 ${
          isExpanded ? 'w-80' : 'w-64'
        }`}
      >
        {/* Header - always visible */}
        <div
          className="flex items-center justify-between px-4 py-3 bg-gray-700/50 cursor-pointer hover:bg-gray-700/70"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <Download className="w-5 h-5 text-blue-400" />
              {processingExports.length > 0 && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
              )}
            </div>
            <div>
              <div className="text-sm font-medium text-white">
                {processingExports.length} Export{processingExports.length !== 1 ? 's' : ''} Active
              </div>
              {primaryExport && (
                <div className="text-xs text-gray-400 truncate max-w-[180px]">
                  {primaryExport.projectName || `Project #${primaryExport.projectId}`} - {primaryExport.progress?.percent ?? 0}%
                </div>
              )}
            </div>
          </div>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          )}
        </div>

        {/* Progress bar for primary export */}
        {primaryExport && (
          <div className="h-1 bg-gray-700">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${primaryExport.progress?.percent ?? 0}%` }}
            />
          </div>
        )}

        {/* Expanded view - list of all exports */}
        {isExpanded && (
          <div className="max-h-64 overflow-y-auto">
            {Object.values(activeExports).map((exp) => (
              <div
                key={exp.exportId}
                className={`px-4 py-3 border-t border-gray-700 ${getStatusColor(exp.status)}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(exp.status)}
                    <div>
                      <div className="text-sm font-medium text-white capitalize">
                        {exp.type} Export
                      </div>
                      <div className="text-xs text-gray-400 truncate max-w-[180px]">
                        {exp.projectName || `Project #${exp.projectId}`}
                      </div>
                    </div>
                  </div>
                  {(exp.status === 'complete' || exp.status === 'error') && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDismiss(exp.exportId);
                      }}
                      className="p-1 hover:bg-gray-600 rounded"
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                {(exp.status === 'pending' || exp.status === 'processing') && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>{exp.progress?.message || 'Processing...'}</span>
                      <span>{exp.progress?.percent ?? 0}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${exp.progress?.percent ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Error message */}
                {exp.status === 'error' && exp.error && (
                  <div className="mt-2 text-xs text-red-400 truncate">
                    {exp.error}
                  </div>
                )}

                {/* Completion message */}
                {exp.status === 'complete' && (
                  <div className="mt-2 text-xs text-green-400">
                    Completed {new Date(exp.completedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default GlobalExportIndicator;
