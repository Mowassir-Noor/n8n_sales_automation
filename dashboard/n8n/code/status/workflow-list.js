// DB - Status: one item per watched workflow (WF0..WF6); the n8n nodes after it run once per item.

// <lib:executions>
// </lib:executions>

return WATCHED_WORKFLOWS.map(w => ({ json: { workflowId: w.id, workflowName: w.name } }));
