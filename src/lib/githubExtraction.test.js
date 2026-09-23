import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExtractionError, GitHubApi, parseArgs, redactSecret, runExtraction, toCsv } from '../../../execution/github-extraction.mjs'

const owner = 'cvs-health-source-code'
const repo = 'fixture-repo'
const iso = '2026-01-01T00:00:00Z'

const commits = {
  direct: { sha: 'a'.repeat(40), commit: { message: 'direct, commit\nbody', author: { name: 'Author', email: 'author@example.com', date: iso }, committer: { name: 'Committer', email: 'committer@example.com', date: iso }, verification: { verified: true, reason: 'valid' } }, author: { login: 'author-login' }, committer: { login: 'committer-login' }, parents: [{ sha: 'p'.repeat(40) }], stats: { additions: 2, deletions: 1 }, files: [{ filename: 'new,name.txt', status: 'renamed', previous_filename: 'old,name.txt', additions: 2, deletions: 1, changes: 3, patch: '@@ -1 +1 @@\n-old\n+new' }], html_url: 'https://github.com/example/commit/a' },
  merge: { sha: 'b'.repeat(40), commit: { message: 'merge commit', author: { name: 'Author', email: 'author@example.com', date: iso }, committer: { name: 'Committer', email: 'committer@example.com', date: iso }, verification: { verified: false, reason: 'unsigned' } }, author: null, committer: null, parents: [{ sha: 'p'.repeat(40) }, { sha: 'q'.repeat(40) }], stats: { additions: 0, deletions: 0 }, files: [], html_url: 'https://github.com/example/commit/b' },
}

class FixtureApi {
  constructor({ includeFeature = true, failOnCommit = false } = {}) { this.includeFeature = includeFeature; this.failOnCommit = failOnCommit; this.requests = [] }
  async request(path) {
    this.requests.push(path)
    if (path === `/repos/${owner}/${repo}`) return { endpoint: path, payload: { default_branch: 'main' } }
    if (path.includes('/compare/')) return { endpoint: path, payload: { ahead_by: 1, behind_by: 0 } }
    if (path.includes('/commits/') && !path.endsWith('/commits/')) {
      if (this.failOnCommit) throw new ExtractionError('fixture failure', 'NETWORK_FAILURE')
      const sha = path.split('/').pop()
      return { endpoint: path, payload: commits[sha === commits.direct.sha ? 'direct' : 'merge'] }
    }
    if (path.includes('/git/ref/tags/')) return { endpoint: path, payload: { object: { type: 'commit', sha: commits.direct.sha } } }
    throw new Error(`unexpected request ${path}`)
  }
  async all(path, query = {}) {
    this.requests.push(`${path}?${new URLSearchParams(query).toString()}`)
    if (path.endsWith('/branches')) return [{ name: 'main', protected: true, commit: { sha: commits.direct.sha } }, ...(this.includeFeature ? [{ name: 'feature/no-pr', protected: false, commit: { sha: commits.merge.sha } }] : [])]
    if (path.endsWith('/commits')) return query.sha === 'main' ? [commits.direct] : [commits.merge, commits.direct]
    if (path.endsWith('/releases')) return []
    if (path.endsWith('/git/refs/tags')) return [{ ref: 'refs/tags/v1.0.0', object: { type: 'commit', sha: commits.direct.sha } }]
    if (path.includes('/assets')) return []
    throw new Error(`unexpected list ${path}`)
  }
}

async function outputDir() { return mkdtemp(join(tmpdir(), 'pmo-github-extraction-')) }
function options(output, mode = 'full') { return { owner, repo, token: 'test-token', output, mode, overlapHours: 24, dryRun: false, verbose: false, forceRefresh: false } }


describe('GitHub extraction', () => {
  it('parses CLI modes and rejects token command-line arguments', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(() => parseArgs(['--owner', owner, '--repo', repo, '--token', 'secret'])).toThrow(/GITHUB_TOKEN|--token/)
    const previousToken = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    try { expect(() => parseArgs(['--owner', owner, '--repo', repo])).toThrow(/GITHUB_TOKEN/) } finally {
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = previousToken
    }
  })

  it('extracts direct and merge commits, renamed files, branches, tags, and raw payloads', async () => {
    const output = await outputDir(); const result = await runExtraction(options(output), { api: new FixtureApi() })
    expect(result.status).toBe('completed')
    const commitCsv = await readFile(join(output, 'normalized', 'commits.csv'), 'utf8')
    expect(commitCsv).toContain('a'.repeat(40)); expect(commitCsv).toContain('feature/no-pr')
    expect(commitCsv).toContain('true')
    const filesCsv = await readFile(join(output, 'normalized', 'commit_files.csv'), 'utf8')
    expect(filesCsv).toContain('old,name.txt')
    const rawFiles = await readFile(join(output, 'raw', result.runId, 'commits.ndjson'), 'utf8')
    expect(rawFiles).toContain('merge commit')
    const checkpoint = JSON.parse(await readFile(join(output, 'state', 'checkpoint.json'), 'utf8'))
    expect(checkpoint.last_successful_boundary).toBeTruthy()
  })

  it('deduplicates overlap reruns and records deleted branches without claiming deletion time', async () => {
    const output = await outputDir(); await runExtraction(options(output), { api: new FixtureApi() })
    const second = await runExtraction(options(output, 'incremental'), { api: new FixtureApi({ includeFeature: false }) })
    const commits = await readFile(join(output, 'normalized', 'commits.csv'), 'utf8')
    expect(commits.split('\n').filter(line => line.includes('a'.repeat(40))).length).toBe(1)
    const branches = await readFile(join(output, 'normalized', 'branch_snapshots.csv'), 'utf8')
    expect(branches).toContain('feature/no-pr'); expect(branches).toContain(',false,')
    expect(second.status).toBe('completed')
  })

  it('leaves the previous checkpoint intact when extraction fails', async () => {
    const output = await outputDir(); await runExtraction(options(output), { api: new FixtureApi() })
    const before = await readFile(join(output, 'state', 'checkpoint.json'), 'utf8')
    await expect(runExtraction(options(output, 'full'), { api: new FixtureApi({ failOnCommit: true }) })).rejects.toThrow('fixture failure')
    expect(await readFile(join(output, 'state', 'checkpoint.json'), 'utf8')).toBe(before)
  })

  it('round-trips CSV escaping and redacts long token-like values', () => {
    const csv = toCsv([{ value: 'line one, "quoted"\nline two' }], ['value'])
    expect(csv).toBe('value\n"line one, ""quoted""\nline two"\n')
    expect(redactSecret('prefix ghp_abcdefghijklmnopqrstuvwxyz1234567890 suffix')).toContain('[REDACTED]')
    expect(redactSecret('short')).toBe('short')
  })

  it('paginates every list response and retries transient responses', async () => {
    let calls = 0; const requestedPages = []
    const api = new GitHubApi('token', { sleep: async () => {}, fetchImpl: async (url) => {
      requestedPages.push(url.searchParams.get('page')); calls += 1
      if (calls === 1) return new Response('{}', { status: 500 })
      const page = Number(url.searchParams.get('page')); const rows = page === 1 ? Array.from({ length: 100 }, (_, index) => ({ index })) : [{ index: 100 }]
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
    } })
    const rows = await api.all('/repos/o/r/branches')
    expect(rows).toHaveLength(101); expect(requestedPages).toEqual(['1', '1', '2'])
  })

  it('fails clearly for rejected authentication', async () => {
    const api = new GitHubApi('token', { fetchImpl: async () => new Response('{}', { status: 401 }), sleep: async () => {} })
    await expect(api.request('/repos/o/r')).rejects.toMatchObject({ code: 'AUTH_REJECTED' })
  })
})
