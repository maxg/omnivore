SELECT * INTO STRICT result FROM precompute_queue;
PERFORM assert(result.key = 'test.in2');
