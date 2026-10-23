import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ESLint, RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import rule from './one-component-per-file.mjs'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

tester.run('one-component-per-file', rule, {
  valid: [
    'export function Page() { return <main /> }',
    'export default function() { return <main /> }',
    'export default () => <main />',
    'const Fallback = <div />; function Page() { return <main>{Fallback}</main> }',
    'const Lazy = dynamic(() => import("./Panel"), { loading: () => <div /> }); function Page() { return <Lazy /> }',
    'const Lazy = React.lazy(() => import("./Panel")); function Page() { return <Lazy /> }',
    'function Page() { return items.map(item => <span>{item}</span>) }',
    'function Configure() { register(() => <div />) }; function Page() { return <main /> }',
    'function Page() { return <main /> }; export { Other } from "./Other"',
    'const Page = memo(forwardRef((props, ref) => <main ref={ref} />))',
    'export type Props = { name: string }; function Page(props: Props) { return <main>{props.name}</main> }',
  ],
  invalid: [
    {
      code: 'function Helper() { return <div /> }; export function Page() { return <Helper /> }',
      errors: [{ messageId: 'multiple', data: { name: 'Page' } }],
    },
    {
      code: 'const First = () => <div />; const Second = () => <span />',
      errors: [{ messageId: 'multiple', data: { name: 'Second' } }],
    },
    {
      code: 'const First = React.memo(React.forwardRef((props, ref) => <div ref={ref} />)); const Second = () => <span />',
      errors: [{ messageId: 'multiple', data: { name: 'Second' } }],
    },
    {
      code: 'class Boundary extends React.Component { render() { return this.props.children } }; function Page() { return <main /> }',
      errors: [{ messageId: 'multiple', data: { name: 'Page' } }],
    },
    {
      code: 'function Helper() { return <div /> }; export default function() { return <Helper /> }',
      errors: [{ messageId: 'multiple', data: { name: 'default' } }],
    },
    {
      code: 'function Helper() { return <div /> }; export default () => <Helper />',
      errors: [{ messageId: 'multiple', data: { name: 'default' } }],
    },
  ],
})

describe('repository convention scope', () => {
  const eslint = new ESLint()
  for (const file of ['app/page.tsx', 'components/editor/EditorToolbar.tsx']) {
    it(`enforces application components in ${file}`, async () => {
      const config = await eslint.calculateConfigForFile(file)
      assert.equal(config.rules['local/one-component-per-file'][0], 2)
    })
  }
  for (const file of [
    'components/ui/dialog.tsx',
    'components/ui/chart-shared.tsx',
    'components/example.test.tsx',
    'components/example.spec.tsx',
  ]) {
    it(`honors the documented exception for ${file}`, async () => {
      const config = await eslint.calculateConfigForFile(file)
      assert.equal(config.rules['local/one-component-per-file'], undefined)
    })
  }
})
