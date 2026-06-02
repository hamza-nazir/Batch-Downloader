import axios from "axios"

const api=axios.create({
baseURL:"https://batch-downloader-dd2z.onrender.com"
})

export default api