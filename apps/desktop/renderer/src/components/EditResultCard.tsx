import { Check, ChevronDown, ChevronRight, FileCode2, ShieldCheck, Undo2 } from 'lucide-react'
import type { EditResult } from '../domain/task-flow'

interface EditResultCardProps {
  result: EditResult
  onToggleFiles: () => void
  onUndo: () => void
  onSubmitReview: () => void
}

export function EditResultCard({ result, onToggleFiles, onUndo, onSubmitReview }: EditResultCardProps) {
  const visibleFiles = result.filesExpanded ? result.files : result.files.slice(0, 3)
  const remainingFiles = result.files.length - visibleFiles.length
  const isUndone = result.actionState === 'undone'
  const isReviewed = result.actionState === 'reviewed'

  return (
    <section className={`edit-result-card edit-result-${result.actionState}`} aria-label="文件修改结果">
      <header className="edit-result-header">
        <div className="edit-result-title-wrap">
          <span className="edit-result-icon"><FileCode2 size={20} strokeWidth={1.7} /></span>
          <div>
            <strong>已编辑 {result.totalFiles} 个文件</strong>
            <div className="edit-result-stats">
              <span className="edit-additions">+{result.totalAdditions}</span>
              <span className="edit-deletions">-{result.totalDeletions}</span>
            </div>
          </div>
        </div>
        <div className="edit-result-actions">
          <button type="button" onClick={onUndo} disabled={isUndone}>
            {isUndone ? <Check size={15} /> : <Undo2 size={15} />}
            {isUndone ? '已撤销' : '撤销'}
          </button>
          <button type="button" onClick={onSubmitReview} disabled={isReviewed}>
            {isReviewed ? <Check size={15} /> : <ShieldCheck size={15} />}
            {isReviewed ? '已提交审核' : '审核'}
          </button>
        </div>
      </header>

      <div className="edit-file-list">
        {visibleFiles.map((file) => (
          <div className="edit-file-row" key={file.path}>
            <span>{file.path}</span>
            <span className="edit-file-stats">
              <span className="edit-additions">+{file.additions}</span>
              <span className="edit-deletions">-{file.deletions}</span>
            </span>
          </div>
        ))}
      </div>

      {result.files.length > 3 ? (
        <button className="edit-files-toggle" type="button" onClick={onToggleFiles} aria-expanded={result.filesExpanded}>
          {result.filesExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {result.filesExpanded ? '收起文件' : `再显示 ${remainingFiles} 个文件`}
        </button>
      ) : null}
    </section>
  )
}
