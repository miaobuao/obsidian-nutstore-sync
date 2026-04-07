import { v7 as uuid } from 'uuid'

export default function createId(prefix: string) {
	return `${prefix}-${uuid()}`
}
