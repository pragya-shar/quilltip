import { httpRouter } from 'convex/server'
import { auth } from './auth'
import { upload, options } from './uploadHttp'

const http = httpRouter()

// Add auth routes
auth.addHttpRoutes(http)

http.route({ path: '/image-upload', method: 'POST', handler: upload })
http.route({ path: '/image-upload', method: 'OPTIONS', handler: options })

export default http
