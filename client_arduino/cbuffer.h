#ifndef _CBUFFER_H
#define _CBUFFER_H

#if defined(ESP32)
  #define OFFLINE_BUFFER_SIZE 600
#elif defined(ESP8266)
  #define OFFLINE_BUFFER_SIZE 120
#endif

#include <Arduino.h>

template <class T>
//Simple circular buffer to store measured values when offline
class CircularBuffer {
private:
  T buffer[OFFLINE_BUFFER_SIZE];
  unsigned int head = 0;
  unsigned int tail = 0;
public:
  //Return tail item to store new data
  T* getTail() {
    //Serial.println("getTail head: " + String(head) + " tail: " + String(tail) + " isEmpty: " + String(isEmpty()) + " isFull: " + String(isFull()));
    return &buffer[tail];
  }
  // Add tail item to circular buffer
  bool enqueue() {
    //Serial.println("enqueue head: " + String(head) + " tail: " + String(tail) + " isEmpty: " + String(isEmpty()) + " isFull: " + String(isFull()));
    if (isFull())  //if full, drop latest record - releases space for a new record
      dequeue();
    tail = (tail + 1) % OFFLINE_BUFFER_SIZE;  // increment tail
  }
  // Remove an item from circular buffer and return it
  T* dequeue() {
    //Serial.println("dequeue head: " + String(head) + " tail: " + String(tail) + " isEmpty: " + String(isEmpty()) + " isFull: " + String(isFull()));
    if (isEmpty())
      return nullptr;
    T* item = &buffer[head]; // get item at head
    head = (head + 1) % OFFLINE_BUFFER_SIZE; // move head foward
    return item;  // return item
  }
  bool isFull() { return head == ((tail + 1) % OFFLINE_BUFFER_SIZE); }
  bool isEmpty() { return head == tail; }
  int size() { return tail >= head ? tail - head : OFFLINE_BUFFER_SIZE - (head - tail);}
};

#endif  //_CBUFFER_H
