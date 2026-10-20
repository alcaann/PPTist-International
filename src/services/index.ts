import axios from './axios'

// fork: only local files. The upstream cloud features (AI slides, AI writing, image search
// through server.pptist.cn) are removed, not just hidden.
export default {
  getMockData(filename: string): Promise<any> {
    return axios.get(`./mocks/${filename}.json`)
  },
}
