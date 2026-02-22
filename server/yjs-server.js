import { Hocuspocus } from "@hocuspocus/server";

const server = new Hocuspocus({
    port: 1234,
});

server.listen().then(() => {
    console.log("Hocuspocus Yjs Server running on ws://localhost:1234");
});
