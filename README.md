# Basewar

REST API project made with Express and MongoDB

## Links

App: https://basewar.herokuapp.com

Github: https://github.com/MediaComem/comem-archioweb

API Doc: https://basewar.herokuapp.com/apidoc/index.html

WebSocket Doc: https://github.com/fly04/basewar/blob/main/doc-websocket.md

## Routes

Users

```http
GET api/users
GET api/users/:id
POST api/users/
DELETE api/users/:id
PATCH api/users/:id
```

Bases

```http
GET api/bases
GET api/bases?ownerId=
GET api/bases/:id

POST api/bases/
DELETE api/bases/:id
PATCH api/bases/:id
```

Investments

```http
POST api/bases/:id/investments
GET api/bases/:id/investments
GET api/bases/:id/investments/:investmentId
DELETE api/bases/:id/investments/:investmentId
```