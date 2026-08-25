let buffer = Buffer.alloc(0);

function send(message) {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	process.stdout.write(`Content-Length: ${body.length}\r\n\r\n${body}`);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	for (;;) {
		const headerEnd = buffer.indexOf("\r\n\r\n");
		if (headerEnd === -1) return;
		const headers = buffer.slice(0, headerEnd);
		const match = /Content-Length: (\d+)/i.exec(headers);
		if (!match) {
			buffer = "";
			return;
		}
		const length = Number.parseInt(match[1], 10);
		const bodyStart = headerEnd + 4;
		if (buffer.length < bodyStart + length) return;
		const message = JSON.parse(buffer.slice(bodyStart, bodyStart + length));
		buffer = buffer.slice(bodyStart + length);
		if (message.method === "initialize") {
			send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
		}
		if (message.method === "shutdown") {
			send({ jsonrpc: "2.0", id: message.id, result: null });
		}
		if (message.method === "exit") {
			process.exit(0);
		}
	}
});
