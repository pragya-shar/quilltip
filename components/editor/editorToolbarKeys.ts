/** Ordered toolbar control keys matching DOM order in EditorToolbar. */
export function getVisibleToolbarKeys(
  isMobile: boolean,
  isLinkActive: boolean
): string[] {
  const keys: string[] = [
    'heading',
    'bold',
    'italic',
    'underline',
    'strike',
    'blockquote',
    'codeBlock',
    'orderedList',
    'bulletList',
  ]
  if (!isMobile) {
    keys.push('alignLeft', 'alignCenter', 'alignRight', 'alignJustify')
  }
  keys.push('add')
  keys.push(isLinkActive ? 'linkRemove' : 'linkInsert')
  if (isMobile) {
    keys.push('more')
  } else {
    keys.push('image', 'youtube')
  }
  keys.push('notes')
  return keys
}

export function resolveActiveToolbarKey(
  activeKey: string,
  visibleKeys: string[]
): string {
  if (visibleKeys.includes(activeKey)) return activeKey
  return visibleKeys[0] ?? 'heading'
}
