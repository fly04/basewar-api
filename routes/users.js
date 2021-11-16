const bcrypt = require("bcrypt");
const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();

const User = require("../models/user");
const Base = require("../models/base");
const Investment = require("../models/investment");
const utils = require("./utils");
const { authenticate } = require("./auth");
const config = require("../config");

/********************************
 * Middlewares
 ********************************/

/**
 * Find user by id
 */
const findUser = (req, res, next) => {
	User.findById(req.params.id).exec((err, user) => {
		if (err) {
			return next(err);
		} else if (!user) {
			let error = new Error("User not found");
			error.status = 404;
			return next(error);
		}
		req.user = user;
		next();
	});
};

/**
 * Save user in database
 */
const saveUser = (req, res, next) => {
	req.user.save(err => {
		if (err) return next(err);
		next();
	});
};

/**
 * Add user
 */
const addUser = (req, res, next) => {
	req.user = new User(req.body);
	req.user.money = 0;
	next();
};

/**
 * Remove user's bases
 */
const removeUserBases = (req, res, next) => {
	Base.find({ ownerId: req.user.id }).exec((err, bases) => {
		if (err) {
			return next(err);
		}

		if (bases.length > 0) {
			bases.forEach(base => {
				Investment.find({ baseId: base.id }).exec((err, investments) => {
					if (err) {
						return next(err);
					}

					if (investments.length > 0) {
						investments.forEach(investment => {
							investment.remove();
						});
					}

					base.remove();
					next();
				});
			});
		} else {
			next();
		}
	});
};

/**
 * Remove user's investments
 */
const removeUserInvestments = (req, res, next) => {
	Investment.find({ investorId: req.user.id }).exec((err, investment) => {
		if (err) {
			return next(err);
		}

		if (investment.length > 0) {
			investment.forEach(investment => {
				investment.remove();
			});
		}

		next();
	});
};

/**
 * Remove user
 */
const removeUser = (req, res, next) => {
	if (req.currentUserId !== req.user.id) {
		let error = new Error("You can't delete this user");
		error.status = 403;
		return next(error);
	} else {
		req.user.remove(err => {
			if (err) return next(new Error(err));
			next();
		});
	}
};

/**
 * Update user
 */
const updateUser = (req, res, next) => {
	if (req.currentUserId !== req.user.id) {
		let error = new Error("You can't edit this user");
		error.status = 403;
		return next(error);
	} else {
		// Update properties in body
		if (req.body.name !== undefined) {
			req.user.name = req.body.name;
		}
		next();
	}
};

/**
 * Hash user password
 */
const hashPassword = (req, res, next) => {
	const plainPassword = req.body.password;
	bcrypt.hash(
		plainPassword,
		config.bcryptCostFactor,
		function (err, hashedPassword) {
			if (err) {
				return next(err);
			}

			req.body.password = hashedPassword;
			next();
		}
	);
};

/**
 * Returns a Mongoose query that will retrieve users filtered with the URL query parameters.
 */
function queryUsers(req) {
	let query = User.find();

	// Filter users by name
	if (req.query.name != null) {
		query = query.where("name").equals(req.query.name);
	}

	return query;
}
/********************************
 * HTTP Methods
 ********************************/

/**
 * GET user
 */
router.get("/:id", findUser, (req, res) => {
	res.send(req.user);
});

/**
 * GET users
 */
router.get("/", function (req, res, next) {
	const countQuery = queryUsers(req);

	countQuery.count(function (err, total) {
		if (err) {
			return next(err);
		}

		let query = queryUsers(req);

		// ===Pagination===
		// Parse pagination parameters from URL query parameters
		const { page, pageSize } = utils.getPaginationParameters(req);

		// Apply skip and limit to select the correct page of elements
		query = query.skip((page - 1) * pageSize).limit(pageSize);

		// Add the Link header to the response
		utils.addLinkHeader("/api/users", page, pageSize, total, res);

		// ===Query execution===
		query.exec(function (err, users) {
			if (err) {
				return next(err);
			}
			res.send(users);
		});
	});
});

/**
 * POST new user
 */
router.post(
	"/",
	utils.requireJson,
	hashPassword,
	addUser,
	saveUser,
	(req, res) => {
		res
			.status(201)
			.set("Location", `${config.baseUrl}/users/${req.user._id}`)
			.send(req.user);
	}
);

/**
 * DELETE new user
 */
router.delete(
	"/:id",
	authenticate,
	findUser,
	removeUserBases,
	removeUserInvestments,
	removeUser,
	(req, res) => {
		console.log("coucou");
		res.status(204).send();
	}
);

/**
 * PATCH user
 */
router.patch(
	"/:id",
	utils.requireJson,
	authenticate,
	findUser,
	updateUser,
	saveUser,
	(req, res) => {
		res
			.status(201)
			.set("Location", `${config.baseUrl}/users/${req.user.id}`)
			.send(req.user);
	}
);

/* Login route
 ********************************/
router.post("/login", function (req, res, next) {
	const secretKey = config.secretKey;

	// Retrieve the user from his name
	User.findOne({ name: req.body.name }).exec(function (err, user) {
		if (err) {
			return next(err);
		} else if (!user) {
			return res.sendStatus(401);
		}

		// Verify that the user correspond to the stored password
		bcrypt.compare(req.body.password, user.password, function (err, valid) {
			if (err) {
				return next(err);
			} else if (!valid) {
				return res.sendStatus(401);
			}

			// Generate a valid JWT which expires in 7 days.
			const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
			const payload = { sub: user._id.toString(), exp: exp };
			jwt.sign(payload, secretKey, function (err, token) {
				if (err) {
					return next(err);
				}

				res.send({ token: token }); // Send the token to the client.
			});
		});
	});
});

module.exports = router;
