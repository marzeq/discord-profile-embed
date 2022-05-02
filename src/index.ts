import express from "express"
import dotenv from "dotenv"
import open from "open"
import OAuth from "discord-oauth2"
import { MongoClient } from "mongodb"
import { html } from "template-tags"
import nodeHtmlToImage from "node-html-to-image"

dotenv.config()

if (!process.env.MONGODB_URI) {
	console.error("env vars are not set")
	process.exit(1)
}

const PORT = process.env.PORT || 8080,
	AUTH = {
		clientId: process.env.CLIENT_ID!,
		clientSecret: process.env.CLIENT_SECRET!,
		redirectUri: process.env.REDIRECT_URI!
	}

const app = express(),
	mongo = new MongoClient(process.env.MONGODB_URI!),
	oauth = new OAuth()

app.get("/", async (req, res) => {
	if (!("userid" in req.query))
		return res.status(400).send({
			message: "Missing userid parameter",
			code: 400
		})

	const userid = req.query.userid as string,
		coll = mongo.db().collection<User>("users"),
		dbuser = await coll.findOne({ id: userid }).catch(_nulllog)

	if (!dbuser)
		return res.status(404).send({
			message: "User not found",
			code: 404
		})

	let accessToken: string = dbuser.access_token

	if (new Date(dbuser.expires_at) < new Date()) {
		const data = await oauth
			.tokenRequest({
				...AUTH,
				refreshToken: dbuser.refresh_token,
				grantType: "refresh_token",
				scope: "identify"
			})
			.catch(_nulllog)

		if (!data)
			return res.status(500).send({
				message: "Failed to refresh token",
				code: 500
			})

		await coll
			.updateOne(
				{ userid },
				{
					$set: {
						access_token: data.access_token,
						refresh_token: data.refresh_token,
						expires_in: data.expires_in,
						expires_at: data.expires_in * 1000 + Date.now()
					}
				}
			)
			.catch(_nulllog)

		accessToken = data.access_token
	}

	const user = await oauth.getUser(accessToken).catch(_nulllog)

	if (!user)
		return res.status(500).send({
			message: "Failed to get user data",
			code: 500
		})

	const flags: string[] = []

	const userflags = user.flags ?? user.public_flags

	if (userflags) {
		if (userflags & (1 << 0)) flags.push("Discord_Staff")
		if (userflags & (1 << 1)) flags.push("discord_partner")
		if (userflags & (1 << 2)) flags.push("HypeSquad_Event")
		if (userflags & (1 << 3)) flags.push("Bug_Hunter")
		if (userflags & (1 << 6)) flags.push("HypeSquad_Bravery")
		if (userflags & (1 << 7)) flags.push("HypeSquad_Brilliance")
		if (userflags & (1 << 8)) flags.push("HypeSquad_Balance")
		if (userflags & (1 << 9)) flags.push("early_supporter")
		if (userflags & (1 << 14)) flags.push("Bug_Hunter_level2")
		if (userflags & (1 << 17)) flags.push("Verified_Bot_Developer")
		if (userflags & (1 << 18)) flags.push("Discord_certified_moderator")
	}

	if (user.premium_type !== 0) flags.push("nitro")

	const buffer = await nodeHtmlToImage({
		html: html`
			<div id="body">
				<div class="main">
					<img class="avatar" src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}?size=128" />
					<h1>
						<span class="username">${user.username}</span>
						<span class="discrim">#${user.discriminator}</span>
					</h1>
				</div>

				<div class="badges">
					${flags.map(
						flag => "<img class='badge' src='https://raw.githubusercontent.com/Mattlau04/Discord-SVG-badges/master/PNG/" + flag + ".png'/>"
					)}
				</div>
			</div>

			<style>
				@import url("https://db.onlinewebfonts.com/c/62b7ed79de33fd64c1c321a150243237?family=Whitney");

				#body {
					display: inline-block;
					background-color: #2f3136;
					font-family: Whitney, sans-serif;
					padding: 10px;
					display: flex;
					align-items: center;
					justify-content: space-between;
				}

				.main {
					display: flex;
					align-items: center;
				}

				.avatar {
					border-radius: 50%;
					margin-right: 10px;
				}

				.username {
					color: #fff;
				}

				.discrim {
					color: rgb(185, 187, 190);
				}

				.badges {
					display: flex;
					align-items: center;
					justify-content: center;
					padding: 15px;
				}

				.badge {
					height: 32px;
				}
			</style>
		`,
		transparent: true,
		selector: "#body",
		puppeteerArgs: {
			args: ["--no-sandbox", "--disable-setuid-sandbox"]
		}
	})

	res.setHeader("Content-Type", "image/png")
	res.send(buffer)
})

app.get("/auth", async (req, res) => {
	if (!("code" in req.query)) return res.redirect(process.env.AUTH_URL!)

	const code = req.query.code as string

	const token = await oauth
		.tokenRequest({
			...AUTH,
			code,
			grantType: "authorization_code",
			scope: "identify"
		})
		.catch(_nulllog)

	if (!token)
		return res.status(500).send({
			message: "Failed to get token",
			code: 500
		})

	const user = await oauth.getUser(token.access_token).catch(_nulllog)

	if (!user)
		return res.status(500).send({
			message: "Failed to get user",
			code: 500
		})

	const coll = mongo.db().collection("users"),
		userData = await coll.findOne({ id: user.id }).catch(_null)

	if (!userData)
		return await coll
			.insertOne({
				id: user.id,
				...token,
				expires_at: token.expires_in * 1000 + Date.now()
			})
			.catch(_nulllog)

	coll.updateOne({ id: user.id }, { $set: { id: user.id, ...token, expires_at: token.expires_in * 1000 + Date.now() } })

	res.send(html`
		<h1>You have been authenticated as ${user.username}#${user.discriminator}</h1>
		<p>You can now close this tab</p>
	`)
})

mongo.connect().then(() => {
	console.log("Connected to database")
	app.listen(PORT, async () => {
		console.log("Server is running.")
		console.log(`http://localhost:${PORT}`)
		open(`http://localhost:${PORT}`)
	})
})

const _null = (_: any) => null
const _nulllog = (err: any) => {
	console.error(err)
	return null
}

interface User {
	id: string
	access_token: string
	refresh_token: string
	expires_in: number
	expires_at: number
	scope: string
	token_type: string
}
