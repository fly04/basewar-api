const debug = require("debug")("my-app:messaging");
const settings = require("./gameSettings");
const WebSocket = require("ws");
const User = require("./models/user");
const Base = require("./models/base");
const Investment = require("./models/investment");
const utils = require("./routes/utils");
const config = require("./config");

// Array of currently connected WebSocket clients.
const users = [];

// Array of active bases i.e. there is at least one user nearby
let activeBases = [];

// Create a WebSocket server using the specified HTTP server.
exports.createWebSocketServer = function (httpServer) {
	debug("Creating WebSocket server");
	const wss = new WebSocket.Server({
		server: httpServer,
	});

	// Handle new client connections.
	wss.on("connection", function (ws) {
		debug("New WebSocket client connected");

		// Listen for messages sent by clients.
		ws.on("message", (message) => {
			// Make sure the message is valid JSON.
			let parsedMessage;
			try {
				parsedMessage = JSON.parse(message);
			} catch (err) {
				// Send an error message to the client with "ws" if you want...
				return debug("Invalid JSON message received from client");
			}

			// Handle the message.
			switch (parsedMessage.command) {
				case "updateLocation":
					handleUpdateLocation(
						ws,
						parsedMessage.location,
						parsedMessage.userId
					);
					break;
			}
		});

		// Clean up disconnected clients and update BDD.
		ws.on("close", () => {
			let userToDisconnect = users.find((user) => {
				return user.client === ws;
			});

			if (userToDisconnect) {
				let disconnectedUser = users.splice(
					users.indexOf(userToDisconnect),
					1
				)[0];
			}
		});
	});
};

// Update user location if user exists else add him to users array
function handleUpdateLocation(ws, location, userId) {
	let userExistsAlready = false;

	if (location.type !== "Point") {
		sendMessageToClient(ws, {
			command: "error",
			params: {
				message: "Invalid location type",
			},
		});
		return;
	}

	if (!validateGeoJsonCoordinates(location.coordinates)) {
		sendMessageToClient(ws, {
			command: "error",
			params: {
				message: "Invalid location coordinates",
			},
		});
		return;
	}

	// Checks if the user is already in the users array
	users.forEach((user) => {
		if (user.client === ws) {
			// If yes, update the user's location
			userExistsAlready = true;

			user.location = location;
		}
	});

	// If not, add the user to the users array
	if (!userExistsAlready) {
		setActiveUser(location, userId, ws);
	}
}

// Add a new user to the users array
function setActiveUser(location, userId, ws) {
	User.findById(userId).exec((err, user) => {
		if (err) {
			sendMessageToClient(ws, {
				command: "error",
				params: {
					message: err.message,
				},
			});
			return;
		}

		if (!user) {
			sendMessageToClient(ws, {
				command: "error",
				params: {
					message: "This userId does not correspond to any user.",
				},
			});
			return;
		}

		users.push({
			client: ws,
			id: user.id,
			money: user.money,
			location: location,
			notification: false,
		});
	});
}

function updateAllActiveBases() {
	Base.find({}).exec((err, storedBases) => {
		if (err) {
			users.forEach((user) => {
				sendMessageToUser(user.id, {
					command: "error",
					params: {
						message: err.message,
					},
				});
			});
			return;
		}

		// Checks if any of the connected users are close to any base
		storedBases.forEach((storedBase) => {
			let baseLong = storedBase.location.coordinates[0];
			let baseLat = storedBase.location.coordinates[1];

			let activeUsers = [];
			users.forEach((user) => {
				let userLong = user.location.coordinates[0];
				let userLat = user.location.coordinates[1];

				// If yes, add the users to activeUsers
				if (
					utils.distanceBetweenTwoPoints(
						baseLat,
						baseLong,
						userLat,
						userLong
					) <= settings.baseRange
				) {
					activeUsers.push(user);
				}
			});

			if (activeUsers.length > 0) {
				Investment.find({ baseId: storedBase.id })
					.count()
					.exec((err, investmentsCount) => {
						if (err) {
							users.forEach((user) => {
								sendMessageToUser(user.id, {
									command: "error",
									params: {
										message: err.message,
									},
								});
							});
							return;
						}

						let income =
							settings.baseIncome +
							investmentsCount * settings.incomeIncreasePerInvestment;

						let newBase = {
							id: storedBase.id,
							name: storedBase.name,
							income: income,
							activeUsers: activeUsers,
							ownerId: storedBase.ownerId,
						};

						const i = activeBases.findIndex(
							(oldBase) => oldBase.id === newBase.id
						);

						if (i > -1) {
							sendUserNotificationToOwner(i);
							activeBases[i] = newBase;
						} else {
							activeBases.push(newBase);
							const j = activeBases.findIndex((base) => base.id === newBase.id);
							sendUserNotificationToOwner(j);
						}
					});
			} else {
				activeBases.splice(
					activeBases.findIndex((base) => storedBase.id === base.id),
					1
				);
			}
		});
	});
}

function sendUserNotificationToOwner(baseIndex) {
	activeBases[baseIndex].activeUsers.forEach((user) => {
		if (
			user.notification === false &&
			activeBases[baseIndex].ownerId != user.id
		) {
			sendMessageToUser(activeBases[baseIndex].ownerId, {
				command: "notification",
				params: {
					baseId: activeBases[baseIndex].id,
					baseName: activeBases[baseIndex].name,
				},
			});
			user.notification = true;
		}
	});
}

// Update every active users money
function updateUsersMoney() {
	activeBases.forEach((base) => {
		let activeUsersCount = base.activeUsers.length;
		let income = base.income;

		if (activeUsersCount > 1) {
			income =
				base.income +
				base.income *
					settings.incomeMultiplierPerActiveUser *
					(activeUsersCount - 1);
		}

		base.activeUsers.forEach((user) => {
			User.findOne({ _id: user.id }, (err, storedUser) => {
				if (err) {
					sendMessageToUser(user.id, {
						command: "error",
						params: {
							message: err.message,
						},
					});
					return;
				}
				user.money = storedUser.money;
				user.money += income;

				users.forEach((maybeInBaseUser) => {
					if (maybeInBaseUser.id === user.id) {
						user.income = income;
					}
				});

				// console.log(user.id);
				// sendMessageToUser(user.id, {
				// 	command: "updateUser",
				// 	params: {
				// 		money: user.money,
				// 		income: income,
				// 	},
				// });

				updateUserMoney(user.id, user.money);
			});
		});
	});
}

// Send active bases to user
function getActiveBases() {
	let basesToSend = activeBases.map((base) => {
		let activeUsers = base.activeUsers.map((user) => {
			return user.id;
		});
		return { id: base.id, activeUsers: activeUsers };
	});

	basesToSend.forEach((base) => {
		base.activeUsers = base.activeUsers.filter((v, i, a) => a.indexOf(v) === i);
	});

	return basesToSend;
}

// Update users money in DB
function updateUserMoney(userId, newAmount) {
	User.findOne({ _id: userId }, (err, user) => {
		if (err) {
			sendMessageToUser(userId, {
				command: "error",
				params: {
					message: err.message,
				},
			});
			return;
		}
		user.money = newAmount;
		user.save();
	});
}

// Send a message to a user
function sendMessageToUser(userId, messageData) {
	let user = users.find((user) => user.id == userId);
	let index = users.indexOf(user);
	if (user) {
		users[index].client.send(JSON.stringify(messageData));
	}
}

// Send a message to a client
function sendMessageToClient(ws, messageData) {
	ws.send(JSON.stringify(messageData));
}

// Validate a GeoJSON coordinates array (longitude, latitude and optional altitude).
function validateGeoJsonCoordinates(value) {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		value.length <= 3 &&
		isLongitude(value[0]) &&
		isLatitude(value[1])
	);
}

function isLatitude(value) {
	return value >= -90 && value <= 90;
}

function isLongitude(value) {
	return value >= -180 && value <= 180;
}

function sendUsersMessage() {
	users.forEach((connectedUser) => {
		let isConnected = false;
		let income = 0;

		activeBases.forEach((base) => {
			base.activeUsers.forEach((userInBase) => {
				if (userInBase.id === connectedUser.id) {
					isConnected = true;
				}
			});
		});

		if (isConnected) {
			income = connectedUser.income;
		}

		sendMessageToUser(connectedUser.id, {
			command: "updateUser",
			params: {
				money: connectedUser.money,
				income: income,
			},
		});
	});
}

// Run update functions every seconds
setInterval(() => {
	updateAllActiveBases();
	updateUsersMoney();
	sendUsersMessage();

	console.log(getActiveBases());
}, 1000);

setInterval(() => {
	users.forEach((user) => {
		sendMessageToClient(user.client, {
			command: "updateBases",
			params: getActiveBases(),
		});
	});
}, config.updateBaseInterval);
