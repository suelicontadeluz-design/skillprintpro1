const reBaseFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>reBaseFetch(input,init);
