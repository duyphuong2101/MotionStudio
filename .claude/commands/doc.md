---
description: Generate documentation from source code
argument-hint: [file path, module, or API routes directory]
---

## Your task

Generate documentation for: $ARGUMENTS

## Process

1. **Read the source code** to understand what it does
2. **Detect the type**:
   - API endpoints → generate endpoint documentation with methods, params, request/response schemas
   - Library/module → generate usage guide with function signatures and examples
   - Component → generate props documentation with types and defaults
3. **Check for existing docs**: If docs exist, update them. Do not create duplicates.
4. **Write documentation** that is accurate, concise, and useful

## Output Format

Match the project's existing documentation format. If no format exists:
- API routes → Markdown table with method, path, description, params, response
- Functions → JSDoc/docstring with params, returns, and one usage example
- Components → Props table with name, type, default, description

## Rules

- Document what the code actually does, not what it should do
- Include all parameters including optional ones with defaults
- One usage example per function/endpoint
- Do not create separate documentation files unless asked — prefer inline docs
