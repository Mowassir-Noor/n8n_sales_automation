// DB - Status: the same seven items again, so 'Get Recent Errors' runs once per workflow
// (not once per execution returned by 'Get Executions').
return $('Workflow List').all().map(i => ({ json: i.json }));
