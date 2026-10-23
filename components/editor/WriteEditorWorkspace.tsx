'use client'
import { useWritingWorkspace } from './useWritingWorkspace'
import { WritingWorkspaceView } from './WritingWorkspaceView'
import './writing-workspace.css'
export function WriteEditorWorkspace() {
  return <WritingWorkspaceView workspace={useWritingWorkspace()} />
}
