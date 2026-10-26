#!/usr/bin/env node
// PostToolUse hook: Remind Claude to update TodoWrite after agent tasks complete
// Analyzes the agent type and result to determine if a todo update is needed

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const subagentType = data.tool_input?.subagent_type || '';
    const description = data.tool_input?.description || '';
    const agentName = data.tool_input?.name || '';
    const runInBackground = data.tool_input?.run_in_background || false;
    const isResume = !!data.tool_input?.resume;
    // PostToolUse carries the result in tool_response (tool_output does not exist)
    const rawResponse = data.tool_response ?? data.tool_output ?? '';
    const output = (typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse)).substring(0, 500);

    // Skip background agents (they haven't finished yet)
    if (runInBackground) {
      process.exit(0);
    }

    // Determine if this agent type warrants a TodoWrite update
    const category = categorizeAgent(subagentType);

    if (category === 'skip') {
      process.exit(0);
    }

    // Check if the output suggests failure/error
    const hasError = /error|failed|exception|could not|unable to/i.test(output.substring(0, 200));
    const hasSuccess = /completed|done|finished|success|updated|created|fixed|implemented/i.test(output.substring(0, 200));

    // Build the reminder message
    let message = '';

    if (category === 'implementation') {
      if (hasError) {
        message = `[Hook] Agent "${subagentType}" (${description}) completed with possible errors. Review the result and update TodoWrite — mark any blocked tasks and add follow-up items if needed.`;
      } else {
        message = `[Hook] Agent "${subagentType}" (${description}) completed. Update TodoWrite — mark the relevant task as completed and check if the next task should start.`;
      }
    } else if (category === 'testing') {
      if (hasError) {
        message = `[Hook] QA agent (${description}) found issues. Update TodoWrite — keep the test task in_progress or add fix items.`;
      } else {
        message = `[Hook] QA agent (${description}) completed. Update TodoWrite — mark testing task as completed.`;
      }
    } else if (category === 'maybe') {
      // Only remind if the output suggests actual work was done
      if (hasSuccess) {
        message = `[Hook] Agent "${subagentType}" (${description}) completed. Consider updating TodoWrite if this resolves a tracked task.`;
      }
    }

    if (message) {
      // Plain PostToolUse stdout never reaches Claude — use additionalContext.
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message },
        })
      );
    }
  } catch (e) {
    // Silent fail — don't block workflow
  }
  process.exit(0);
});

/**
 * Categorize agent type to determine TodoWrite update behavior
 * @returns {'implementation'|'testing'|'maybe'|'skip'}
 */
function categorizeAgent(subagentType) {
  const type = (subagentType || '').toLowerCase();

  // Always update: these agents do real implementation work
  if (type === 'senior-dev' || type === 'dev-quick') return 'implementation';

  // Always update: testing/QA agents
  if (type === 'qa') return 'testing';

  // Maybe update: planning + the project explore agent (runs workflow CODE_REVIEW)
  if (type === 'tech-lead' || type === 'explore') return 'maybe';

  // Skip: built-in research agents (Explore, Plan, claude-code-guide, etc.)
  return 'skip';
}
